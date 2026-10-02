"""Structured user profile document and update payloads."""
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class EducationEntry(BaseModel):
    institution: str = ""
    degree: str = ""
    field_of_study: str = ""
    start_date: str = ""
    end_date: str = ""
    details: str = ""


class ExperienceEntry(BaseModel):
    company: str = ""
    title: str = ""
    location: str = ""
    start_date: str = ""
    end_date: str = ""
    description: str = ""


class ProjectEntry(BaseModel):
    name: str = ""
    description: str = ""
    technologies: list[str] = Field(default_factory=list)
    url: str = ""


JobPreference = str


class ProfileDoc(BaseModel):
    id: str = "global"
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
    additional_preferences: list[str] = Field(default_factory=list)
    work_experience: list[ExperienceEntry] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    linkedin_url: str = ""
    github_url: str = ""
    leetcode_url: str = ""
    resume_text: str = ""
    resume_filename: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @classmethod
    def from_mongo(cls, doc: dict) -> "ProfileDoc":
        normalized = dict(doc)
        if "_id" in normalized:
            normalized["id"] = str(normalized.pop("_id"))
        # Read profiles saved by the previous flat profile form without losing data.
        if "profile_summary" not in normalized and normalized.get("text_resume"):
            normalized["profile_summary"] = normalized["text_resume"]
        if "additional_preferences" not in normalized and normalized.get("preferences"):
            normalized["additional_preferences"] = normalized["preferences"]
        return cls(**{key: value for key, value in normalized.items() if key in cls.model_fields})


class ProfileUpdate(BaseModel):
    name: str | None = None
    profile_summary: str | None = None
    education: list[EducationEntry] | None = None
    certifications: list[str] | None = None
    address: str | None = None
    preferred_locations: list[str] | None = None
    expected_ctc: str | None = None
    current_ctc: str | None = None
    skills: list[str] | None = None
    job_preference: JobPreference | None = None
    additional_preferences: list[str] | None = None
    work_experience: list[ExperienceEntry] | None = None
    projects: list[ProjectEntry] | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    leetcode_url: str | None = None
