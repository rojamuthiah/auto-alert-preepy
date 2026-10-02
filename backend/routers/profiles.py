"""
FastAPI router for User Profiles.
"""
from __future__ import annotations
import asyncio
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from io import BytesIO
from zipfile import ZipFile
import re
import shutil
import subprocess
import time
from typing import Any
from db.mongo import profiles_col
from models.profile import ProfileDoc, ProfileUpdate
from logger import get_logger
from providers.llm_factory import PROVIDER_MODELS

log = get_logger("router.profiles")
router = APIRouter(prefix="/profile", tags=["profile"])

SECTION_NAMES = {
    "profile_summary": {"summary", "professional summary", "profile", "objective", "career objective", "about me"},
    "skills": {"skills", "technical skills", "core skills", "key skills", "technologies", "technical expertise"},
    "work_experience": {"experience", "work experience", "employment", "professional experience", "work history"},
    "education": {"education", "academic background", "qualifications"},
    "projects": {"projects", "personal projects", "selected projects"},
    "certifications": {"certifications", "certificates", "licenses and certifications"},
}


def _basic_resume_extract(text: str) -> dict[str, Any]:
    """Extract common resume sections and profile links without requiring an LLM key."""
    result: dict[str, Any] = {}
    # Preserve a likely name from the resume header even when the configured LLM
    # times out or returns only partial structured output.
    header_lines = [line.strip() for line in text.splitlines() if line.strip()][:8]
    for line in header_lines:
        candidate = re.sub(r"\s+", " ", line.strip(" |•*-\t"))
        if (len(candidate) <= 80
                and re.fullmatch(r"[A-Za-z][A-Za-z .'-]*", candidate)
                and 1 < len(candidate.split()) <= 5
                and not re.search(r"\b(resume|cv|curriculum|linkedin|github|software|engineer|developer|programmer|analyst|manager|designer|architect|consultant|student|intern|senior|junior|lead)\b|@|\d", candidate, re.I)):
            result["name"] = candidate
            break
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip().strip("•*-| ")
        if not line:
            continue
        heading = re.sub(r"[^a-z ]", "", line.lower()).strip()
        matched = next((key for key, names in SECTION_NAMES.items() if heading in names), None)
        if matched:
            current = matched
            sections.setdefault(current, [])
        elif current:
            sections[current].append(line)

    def lines_for(name: str) -> list[str]:
        return [re.sub(r"\s+", " ", line).strip() for line in sections.get(name, []) if line.strip()]

    summary_lines = lines_for("profile_summary")
    if summary_lines:
        result["profile_summary"] = " ".join(summary_lines)

    skill_lines = lines_for("skills")
    if skill_lines:
        skills = [part.strip(" •-*\t") for line in skill_lines for part in re.split(r"[,|•;]", line) if part.strip(" •-*\t")]
        result["skills"] = list(dict.fromkeys(skills))[:80]

    for key, pattern in (("linkedin_url", r"https?://(?:www\.)?linkedin\.com/[^\s)>,]+"),
                         ("github_url", r"https?://(?:www\.)?github\.com/[^\s)>,]+"),
                         ("leetcode_url", r"https?://(?:www\.)?leetcode\.com/[^\s)>,]+")):
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            result[key] = match.group(0).rstrip(".,;")

    certs = lines_for("certifications")
    if certs:
        result["certifications"] = list(dict.fromkeys(certs))[:40]

    education_lines = lines_for("education")
    if education_lines:
        result["education"] = [{"institution": line, "degree": "", "field_of_study": "", "start_date": "", "end_date": "", "details": ""} for line in education_lines[:20]]

    # Keep project/work section text intact in a useful editable description instead of
    # guessing company names, titles, dates, or impact from unstructured lines.
    project_lines = lines_for("projects")
    if project_lines:
        result["projects"] = [{"name": line[:120], "description": "", "technologies": [], "url": ""} for line in project_lines[:30]]

    experience_lines = lines_for("work_experience")
    if experience_lines:
        result["work_experience"] = [{"company": "", "title": "", "location": "", "start_date": "", "end_date": "", "description": line} for line in experience_lines[:40]]
    return result


@router.get("")
async def get_profile() -> dict:
    doc = await profiles_col().find_one({"_id": "global"})
    if not doc:
        # Return default empty profile
        return ProfileDoc().model_dump()
    profile = ProfileDoc.from_mongo(doc).model_dump()
    if not profile.get("name") and profile.get("resume_text"):
        extracted_name = _basic_resume_extract(profile["resume_text"]).get("name")
        if extracted_name:
            profile["name"] = extracted_name
            await profiles_col().update_one({"_id": "global"}, {"$set": {"name": extracted_name}})
            log.info("profile_name_recovered_from_resume", source="saved_resume")
    return profile


@router.patch("")
async def update_profile(body: ProfileUpdate) -> dict:
    updates = body.model_dump(exclude_unset=True)

    if not updates:
        return (await get_profile())

    result = await profiles_col().find_one_and_update(
        {"_id": "global"},
        {"$set": updates},
        upsert=True,
        return_document=True,
    )
    log.info("profile_api_updated", fields=list(updates.keys()))
    if not result:
        # Happens on creation
        doc = await profiles_col().find_one({"_id": "global"})
        return ProfileDoc.from_mongo(doc).model_dump() if doc else ProfileDoc().model_dump()
    
    return ProfileDoc.from_mongo(result).model_dump()


@router.post("/resume")
async def upload_resume(file: UploadFile = File(...), provider: str = Form(...), model: str = Form(...)) -> dict:
    """Extract text from a PDF, DOCX, or plain text resume and save it to the profile."""
    filename = file.filename or "resume"
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in {"pdf", "docx", "txt"}:
        raise HTTPException(status_code=415, detail="Upload a PDF, DOCX, or TXT resume.")
    if provider not in PROVIDER_MODELS or model not in PROVIDER_MODELS[provider]:
        raise HTTPException(status_code=422, detail="Choose a supported provider and model before uploading your resume.")
    raw = await file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Resume must be 10 MB or smaller.")
    try:
        if suffix == "pdf":
            try:
                from pypdf import PdfReader
                text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages)
            except ModuleNotFoundError as exc:
                # Poppler is a fallback for local environments where the Python
                # dependency has not been installed yet.
                pdftotext = shutil.which("pdftotext")
                if not pdftotext:
                    raise ModuleNotFoundError("PDF support requires pypdf or pdftotext.", name="pypdf") from exc
                result = subprocess.run(
                    [pdftotext, "-layout", "-", "-"], input=raw,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True,
                )
                text = result.stdout.decode("utf-8", errors="replace")
        elif suffix == "docx":
            with ZipFile(BytesIO(raw)) as archive:
                from xml.etree import ElementTree
                root = ElementTree.fromstring(archive.read("word/document.xml"))
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                text = "\n".join("".join(node.itertext()) for node in root.findall(".//w:p", ns))
        else:
            text = raw.decode("utf-8-sig")
    except ModuleNotFoundError as exc:
        if suffix == "pdf" and exc.name == "pypdf":
            raise HTTPException(status_code=503, detail="PDF extraction is not installed in the backend. From the backend folder run: pip install -r requirements.txt, then restart the API.") from exc
        raise HTTPException(status_code=422, detail="Could not extract text from this file. Try another copy or paste the resume manually.") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Could not extract text from this file. Try another copy or paste the resume manually.") from exc
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        raise HTTPException(status_code=422, detail="No readable text found. Scanned PDFs need OCR; you can paste the text manually.")
    extracted: dict = _basic_resume_extract(text)
    structured_extraction = False
    extraction_started = time.monotonic()
    log.info("resume_ai_extraction_started", filename=filename, characters=len(text), provider=provider, model=model)
    try:
        from pydantic import BaseModel, Field
        from models.profile import EducationEntry, ExperienceEntry, ProjectEntry, JobPreference
        from providers.llm_factory import get_llm_from_db

        class ResumeFields(BaseModel):
            name: str = ""
            profile_summary: str = ""
            education: list[EducationEntry] = Field(default_factory=list)
            certifications: list[str] = Field(default_factory=list)
            address: str = ""
            preferred_locations: list[str] = Field(default_factory=list)
            expected_ctc: str = ""
            current_ctc: str = ""
            skills: list[str] = Field(default_factory=list)
            job_preference: JobPreference | None = None
            work_experience: list[ExperienceEntry] = Field(default_factory=list)
            projects: list[ProjectEntry] = Field(default_factory=list)
            linkedin_url: str = ""
            github_url: str = ""
            leetcode_url: str = ""

        def normalize_gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
            # Gemini's function schema rejects JSON Schema annotations and
            # ignores $defs, so inline local model references before sending it.
            definitions = schema.get("$defs", {})

            def normalize(value: Any) -> Any:
                if isinstance(value, list):
                    return [normalize(item) for item in value]
                if not isinstance(value, dict):
                    return value
                ref = value.get("$ref")
                if ref and ref.startswith("#/$defs/"):
                    definition = definitions.get(ref.rsplit("/", 1)[-1])
                    if definition is not None:
                        value = {**definition, **{k: v for k, v in value.items() if k != "$ref"}}
                return {
                    key: normalize(item)
                    for key, item in value.items()
                    if key not in {"title", "$defs", "$ref"}
                }

            return normalize(schema)

        try:
            llm = await get_llm_from_db(provider, model=model)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        tool_schema = {
            "name": "extract_resume_profile",
            "description": "Extract profile fields explicitly stated in a resume.",
            "parameters": normalize_gemini_schema(ResumeFields.model_json_schema()),
        }
        parser = llm.with_structured_output(tool_schema)
        result = await asyncio.wait_for(
            parser.ainvoke(
                "Extract the user's full name exactly as written in the resume when present. "
                "Extract only information explicitly present in this resume. Never infer salary, address, "
                "preferred location, or preference. Keep missing fields empty and preserve concise factual wording.\n\n"
                + text[:40000]
            ),
            timeout=180,
        )
        llm_fields = ResumeFields.model_validate(result).model_dump(exclude_none=True)
        llm_fields = {key: value for key, value in llm_fields.items() if value not in (None, "", [])}
        extracted = {**extracted, **llm_fields}
        structured_extraction = bool(llm_fields)
        log.info(
            "resume_ai_extraction_finished",
            filename=filename,
            elapsed_seconds=round(time.monotonic() - extraction_started, 2),
            fields=list(llm_fields.keys()),
        )
    except asyncio.TimeoutError as exc:
        log.warning(
            "resume_ai_extraction_timed_out",
            filename=filename,
            elapsed_seconds=round(time.monotonic() - extraction_started, 2),
        )
        # Keep the extracted text and basic fields; the route should not hang indefinitely.
        log.warning(
            "resume_structured_extraction_unavailable",
            error=f"{provider}/{model} extraction timed out after 180 seconds.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        # Resume text is still saved; extraction can be retried by editing profile manually.
        log.warning("resume_structured_extraction_unavailable", error=str(exc))

    await profiles_col().update_one(
        {"_id": "global"},
        {"$set": {**extracted, "resume_text": text, "resume_filename": filename}},
        upsert=True,
    )
    log.info("resume_uploaded", filename=filename, extracted_characters=len(text))
    profile = await get_profile()
    profile["extraction_status"] = "complete" if structured_extraction else "partial" if extracted else "text_only"
    return profile
