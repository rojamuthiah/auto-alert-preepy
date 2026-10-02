"""
FastAPI router for Plans.
All async. Delegates to MongoDB directly for CRUD.
"""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from zipfile import BadZipFile, ZipFile
import re
import xml.etree.ElementTree as ET

from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from db.mongo import plans_col, traces_col
from models.plan import PlanDoc, PlanRow, PlanSummary, PlanUpdate
from logger import get_logger

log = get_logger("router.plans")
router = APIRouter(prefix="/plans", tags=["plans"])


def _read_xlsx_rows(content: bytes) -> list[dict[str, str]]:
    """Read the first worksheet from a normal Excel .xlsx file without extra deps."""
    try:
        with ZipFile(BytesIO(content)) as archive:
            ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
            strings: list[str] = []
            if "xl/sharedStrings.xml" in archive.namelist():
                root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
                strings = ["".join(node.itertext()) for node in root.findall("x:si", ns)]
            workbook = ET.fromstring(archive.read("xl/workbook.xml"))
            rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            rel_ns = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
            sheet = workbook.find("x:sheets/x:sheet", ns)
            if sheet is None:
                raise ValueError("The workbook has no worksheets.")
            rel_id = sheet.attrib[f"{{{ns['r']}}}id"]
            target = next((rel.attrib["Target"] for rel in rels.findall("r:Relationship", rel_ns) if rel.attrib.get("Id") == rel_id), None)
            if not target:
                raise ValueError("Could not locate the first worksheet.")
            sheet_path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            sheet_root = ET.fromstring(archive.read(sheet_path))
            grid: list[list[str]] = []
            for row in sheet_root.findall(".//x:sheetData/x:row", ns):
                values: dict[int, str] = {}
                for cell in row.findall("x:c", ns):
                    match = re.match(r"([A-Z]+)", cell.attrib.get("r", ""))
                    if not match:
                        continue
                    col = 0
                    for letter in match.group(1):
                        col = col * 26 + ord(letter) - 64
                    col -= 1
                    value_node = cell.find("x:v", ns)
                    value = "" if value_node is None else value_node.text or ""
                    if cell.attrib.get("t") == "s" and value:
                        value = strings[int(value)]
                    elif cell.attrib.get("t") == "inlineStr":
                        inline = cell.find("x:is", ns)
                        value = "" if inline is None else "".join(inline.itertext())
                    values[col] = value
                if values:
                    grid.append([values.get(i, "") for i in range(max(values) + 1)])
    except (BadZipFile, KeyError, ET.ParseError, IndexError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not read this Excel workbook: {exc}") from exc
    if len(grid) < 2:
        raise HTTPException(status_code=422, detail="The workbook needs a header row and at least one company row.")
    headers = [value.strip().lower().replace(" ", "_") for value in grid[0]]
    required = {"company", "tier", "priority", "careers_page"}
    missing = sorted(required - set(headers))
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required columns: {', '.join(missing)}")
    rows = []
    for line_number, values in enumerate(grid[1:], start=2):
        data = {headers[i]: values[i].strip() if i < len(values) else "" for i in range(len(headers)) if headers[i]}
        if not any(data.values()):
            continue
        careers_page = data.get("careers_page", "")
        if not careers_page.startswith(("https://", "http://")):
            raise HTTPException(status_code=422, detail=f"Excel row {line_number} needs a valid careers_page URL.")
        try:
            rows.append(PlanRow(
                company=data.get("company", ""), tier=data.get("tier", ""), priority=data.get("priority", ""),
                remarks=data.get("remarks", ""), careers_page=careers_page,
            ).model_dump())
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid values on Excel row {line_number}: {exc}") from exc
        if len(rows) > 200:
            raise HTTPException(status_code=422, detail="A plan can contain at most 200 rows.")
    if not rows:
        raise HTTPException(status_code=422, detail="No company rows found in the workbook.")
    return rows


def _sample_xlsx() -> bytes:
    """Create a tiny standards-compliant workbook sample in memory."""
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Companies" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>company</t></is></c><c r="B1" t="inlineStr"><is><t>tier</t></is></c><c r="C1" t="inlineStr"><is><t>priority</t></is></c><c r="D1" t="inlineStr"><is><t>remarks</t></is></c><c r="E1" t="inlineStr"><is><t>careers_page</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Example Technologies</t></is></c><c r="B2" t="inlineStr"><is><t>T1</t></is></c><c r="C2" t="inlineStr"><is><t>High</t></is></c><c r="D2" t="inlineStr"><is><t>Example row; replace with your target company</t></is></c><c r="E2" t="inlineStr"><is><t>https://example.com/careers</t></is></c></row></sheetData></worksheet>',
    }
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        for path, body in files.items():
            archive.writestr(path, body)
    return output.getvalue()


# ---------------------------------------------------------------------------
# GET /plans  — list promoted (visible) plans
# ---------------------------------------------------------------------------
@router.get("")
async def list_plans() -> list[dict]:
    cursor = plans_col().find({"hidden": False}, {"rows": 0}).sort("created_at", -1)
    docs = await cursor.to_list(length=500)
    return [PlanSummary.from_mongo(d).model_dump() for d in docs]


@router.get("/sample.xlsx")
async def download_plan_sample() -> StreamingResponse:
    return StreamingResponse(
        BytesIO(_sample_xlsx()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="prep-studio-plan-template.xlsx"'},
    )


@router.post("/import", status_code=201)
async def import_plan(
    name: str = Form(...),
    key: str = Form(...),
    file: UploadFile = File(...),
) -> dict:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="Upload an Excel .xlsx file.")
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Excel file must be 5 MB or smaller.")
    rows = _read_xlsx_rows(content)
    now = datetime.now(timezone.utc)
    doc = {
        "chat_id": "manual-import",
        "name": name.strip()[:100],
        "key": key.strip()[:100],
        "provider": "gemini",
        "hidden": False,
        "rows": rows,
        "created_at": now,
    }
    if not doc["name"] or not doc["key"]:
        raise HTTPException(status_code=422, detail="Plan name and key are required.")
    result = await plans_col().insert_one(doc)
    doc["_id"] = result.inserted_id
    await traces_col().insert_one({
        "type": "plan_tool", "source": "api:import_plan",
        "payload": {"plan_id": str(result.inserted_id), "row_count": len(rows)},
        "created_at": now,
    })
    log.info("plan_imported", plan_id=str(result.inserted_id), rows=len(rows))
    return PlanDoc.from_mongo(doc).model_dump()


# ---------------------------------------------------------------------------
# GET /plans/{plan_id}
# ---------------------------------------------------------------------------
@router.get("/{plan_id}")
async def get_plan(plan_id: str) -> dict:
    doc = await plans_col().find_one({"_id": ObjectId(plan_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Plan not found")
    return PlanDoc.from_mongo(doc).model_dump()


# ---------------------------------------------------------------------------
# PATCH /plans/{plan_id}/promote  — add to Job Plans
# ---------------------------------------------------------------------------
@router.patch("/{plan_id}/promote")
async def promote_plan(plan_id: str) -> dict:
    result = await plans_col().find_one_and_update(
        {"_id": ObjectId(plan_id)},
        {"$set": {"hidden": False}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")

    await traces_col().insert_one(
        {
            "type": "plan_tool",
            "source": "api:promote_plan",
            "payload": {"plan_id": plan_id, "action": "promoted"},
            "created_at": datetime.now(timezone.utc),
        }
    )
    log.info("plan_promoted", plan_id=plan_id)
    return {"ok": True, "plan_id": plan_id}


# ---------------------------------------------------------------------------
# PATCH /plans/{plan_id}  — edit name or key
# ---------------------------------------------------------------------------
@router.patch("/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate) -> dict:
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.key is not None:
        updates["key"] = body.key
    if body.rows is not None:
        if len(body.rows) > 200:
            raise HTTPException(status_code=400, detail="Max 200 rows per plan")
        updates["rows"] = [r.model_dump() for r in body.rows]

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    result = await plans_col().find_one_and_update(
        {"_id": ObjectId(plan_id)},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")

    log.info("plan_updated", plan_id=plan_id, fields=list(updates.keys()))
    return PlanDoc.from_mongo(result).model_dump()


# ---------------------------------------------------------------------------
# DELETE /plans/{plan_id}
# ---------------------------------------------------------------------------
@router.delete("/{plan_id}", status_code=204, response_class=Response)
async def delete_plan(plan_id: str) -> Response:
    result = await plans_col().delete_one({"_id": ObjectId(plan_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    log.info("plan_deleted", plan_id=plan_id)
    return Response(status_code=204)
