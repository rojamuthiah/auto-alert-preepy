import { ChangeEvent, useEffect, useRef, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, FileText, LoaderCircle, Plus, Save, Upload, UserRound, X, Trash2 } from "lucide-react"
import CreatableSelect from 'react-select/creatable'
import SearchableSelect from "../components/SearchableSelect"

type Education = { institution: string; degree: string; field_of_study: string; start_date: string; end_date: string; details: string }
type Experience = { company: string; title: string; location: string; start_date: string; end_date: string; description: string }
type Project = { name: string; description: string; technologies: string[]; url: string }
type Profile = {
    name: string; profile_summary: string; education: Education[]; certifications: string[]; address: string
    preferred_locations: string[]; expected_ctc: string; current_ctc: string; skills: string[]
    job_preference: string | null
    additional_preferences: string[]; work_experience: Experience[]; projects: Project[]
    linkedin_url: string; github_url: string; leetcode_url: string; resume_filename?: string
}

const blank: Profile = { name: "", profile_summary: "", education: [], certifications: [], address: "", preferred_locations: [], expected_ctc: "", current_ctc: "", skills: [], job_preference: null, additional_preferences: [], work_experience: [], projects: [], linkedin_url: "", github_url: "", leetcode_url: "" }
const api = "/api/profile"

// Custom Sharp Styles
const inputClass = "w-full border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-colors shadow-sm"
const labelClass = "mb-1.5 block text-sm font-semibold text-zinc-900"
const sectionClass = "space-y-6 border border-zinc-200 bg-white p-6 md:p-8 shadow-sm"
const skillsCatalog = ["JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust", "React", "Node.js", "SQL", "MongoDB", "AWS", "Docker", "Kubernetes", "System Design", "Machine Learning", "Data Analysis", "Product Management", "Figma"]
type ExtractionProvider = "openai" | "claude" | "gemini"
const fallbackExtractionModels: Record<ExtractionProvider, string[]> = {
    openai: ["gpt-5.2", "gpt-5-mini", "gpt-4.1"],
    claude: ["claude-sonnet-5", "claude-haiku-4-5"],
    gemini: ["gemini-2.5-flash"],
}

const emptyEducation = (): Education => ({ institution: "", degree: "", field_of_study: "", start_date: "", end_date: "", details: "" })
const emptyExperience = (): Experience => ({ company: "", title: "", location: "", start_date: "", end_date: "", description: "" })
const emptyProject = (): Project => ({ name: "", description: "", technologies: [], url: "" })
const toDateValue = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
    if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`
    if (/^\d{4}$/.test(value)) return `${value}-01-01`
    return ""
}

function CalendarDatePicker({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    const [open, setOpen] = useState(false)
    const [view, setView] = useState(() => {
        const date = toDateValue(value)
        return date ? new Date(`${date}T12:00:00`) : new Date()
    })
    const selected = toDateValue(value)
    const monthStart = new Date(view.getFullYear(), view.getMonth(), 1)
    const offset = (monthStart.getDay() + 6) % 7
    const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
    const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => i - offset + 1)
    const monthLabel = view.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    const displayValue = selected ? new Date(`${selected}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""

    return <div className="relative">
        <button type="button" onClick={() => { if (!open && selected) setView(new Date(`${selected}T12:00:00`)); setOpen(!open) }} aria-expanded={open} className={`${inputClass} flex items-center justify-between gap-2 text-left ${displayValue ? "text-zinc-900" : "text-zinc-400"}`}>
            <span>{displayValue || placeholder}</span><CalendarDays className="h-4 w-4 shrink-0 text-zinc-500" />
        </button>
        {open && <div className="absolute left-0 top-full z-30 mt-2 w-[19rem] border border-zinc-200 bg-white p-4 shadow-xl" role="dialog" aria-label={`${placeholder} calendar`}>
            <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} className="grid h-8 w-8 place-items-center hover:bg-zinc-100"><ChevronLeft className="h-4 w-4" /></button><p className="text-sm font-semibold">{monthLabel}</p><button type="button" aria-label="Next month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} className="grid h-8 w-8 place-items-center hover:bg-zinc-100"><ChevronRight className="h-4 w-4" /></button></div>
            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-zinc-500">{["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
            <div className="grid grid-cols-7 gap-y-1">{cells.map((day, i) => {
                const valid = day >= 1 && day <= daysInMonth
                const date = valid ? new Date(view.getFullYear(), view.getMonth(), day) : null
                const iso = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` : ""
                const isSelected = iso === selected
                const isToday = date?.toDateString() === new Date().toDateString()
                return <button key={i} type="button" disabled={!valid} onClick={() => { onChange(iso); setOpen(false) }} className={`mx-auto grid h-9 w-9 place-items-center text-sm transition-colors disabled:pointer-events-none disabled:opacity-0 ${isSelected ? "bg-zinc-900 font-semibold text-white" : isToday ? "border border-zinc-400 font-semibold text-zinc-900" : "text-zinc-700 hover:bg-zinc-100"}`}>{valid ? day : ""}</button>
            })}</div>
            <div className="mt-3 flex items-center justify-between border-t pt-3"><button type="button" onClick={() => { onChange(""); setOpen(false) }} className="text-xs text-zinc-500 hover:text-zinc-900">Clear date</button><button type="button" onClick={() => { const now = new Date(); onChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`); setView(now); setOpen(false) }} className="text-xs font-medium text-zinc-900 hover:underline">Today</button></div>
        </div>}
    </div>
}

async function readApiResponse(response: Response, fallback: string) {
    const body = await response.text()
    let data: any = {}
    if (body) {
        try { data = JSON.parse(body) }
        catch { data = { detail: body.slice(0, 300) } }
    }
    if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : data.message
        throw new Error(detail || `${fallback} (HTTP ${response.status}). Check that the Prep Studio API and database are running.`)
    }
    if (!body) throw new Error(`${fallback}: the server returned an empty response. Check that the Prep Studio API is running.`)
    return data
}

// React-Select custom sharp theme 
const selectStyles = {
    control: (base: any, state: any) => ({
        ...base,
        fontFamily: "Inter, sans-serif",
        borderRadius: 0, // SHARP CORNERS
        borderColor: state.isFocused ? '#71717a' : 'var(--select-border)',
        boxShadow: state.isFocused ? '0 0 0 1px #71717a' : 'none',
        backgroundColor: 'var(--select-surface)',
        color: 'var(--select-text)',
        minHeight: '2.5rem',
        padding: '2px',
        fontSize: '0.875rem' // text-sm
    }),
    multiValue: (base: any) => ({
        ...base,
        backgroundColor: 'var(--select-highlight)',
        borderRadius: 0,
        fontWeight: '500',
        color: 'var(--select-text)'
    }),
    multiValueLabel: (base: any) => ({ ...base, color: 'var(--select-text)' }),
    multiValueRemove: (base: any) => ({ ...base, color: 'var(--select-text)', ':hover': { backgroundColor: '#7f1d1d', color: '#fecaca' } }),
    singleValue: (base: any) => ({ ...base, color: 'var(--select-text)' }),
    input: (base: any) => ({ ...base, color: 'var(--select-text)' }),
    placeholder: (base: any) => ({ ...base, color: '#a1a1aa' }),
    menu: (base: any) => ({ ...base, backgroundColor: 'var(--select-surface)', zIndex: 50 }),
    option: (base: any, state: any) => ({ ...base, backgroundColor: state.isFocused ? 'var(--select-highlight)' : 'var(--select-surface)', color: 'var(--select-text)' })
}

// Wrapper to easily convert strings array to select option objects
function SharpMultiSelect({ value, onChange, placeholder, options }: { value: string[], onChange: (v: string[]) => void, placeholder: string, options?: string[] }) {
    return (
        <CreatableSelect
            isMulti
            isSearchable
            classNamePrefix="profile-select"
            styles={selectStyles}
            placeholder={placeholder}
            value={value.map(v => ({ label: v, value: v }))}
            onChange={(newValue) => onChange(newValue.map((v: any) => v.value))}
            options={(options || []).map(o => ({ label: o, value: o }))}
            formatCreateLabel={(val) => `Add "${val}"`}
        />
    )
}

function SharpSingleSelect({ value, onChange, placeholder, options }: { value: string | null; onChange: (v: string | null) => void; placeholder: string; options: string[] }) {
    return <CreatableSelect
        isSearchable
        classNamePrefix="profile-select"
        styles={selectStyles}
        isClearable
        placeholder={placeholder}
        value={value ? { label: value, value } : null}
        onChange={(option: any) => onChange(option?.value || null)}
        options={options.map((option) => ({ label: option, value: option }))}
        formatCreateLabel={(option) => `Use “${option}”`}
    />
}

export default function ProfilePage() {
    const [profile, setProfile] = useState<Profile>(blank)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [notice, setNotice] = useState("")
    const [savedToast, setSavedToast] = useState(false)
    const [providerStatus, setProviderStatus] = useState<Record<ExtractionProvider, boolean>>({ openai: false, claude: false, gemini: false })
    const [extractionModels, setExtractionModels] = useState<Record<ExtractionProvider, string[]>>(fallbackExtractionModels)
    const [extractionProvider, setExtractionProvider] = useState<ExtractionProvider | "">("")
    const [extractionModel, setExtractionModel] = useState<string>("")
    const [error, setError] = useState("")
    const [dragActive, setDragActive] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    const update = <K extends keyof Profile>(key: K, value: Profile[K]) => setProfile((p) => ({ ...p, [key]: value }))

    const load = async () => {
        let response: Response
        try { response = await fetch(api) }
        catch { throw new Error("Could not reach the profile service. Start the backend API and MongoDB, then reload this page.") }
        const data = await readApiResponse(response, "Could not load your profile")
        setProfile({ ...blank, ...data })
    }

    useEffect(() => {
        load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false))
    }, [])

    useEffect(() => {
        fetch("/api/settings").then((response) => response.json()).then((data) => {
            const status = { openai: Boolean(data.providers?.openai?.configured), claude: Boolean(data.providers?.claude?.configured), gemini: Boolean(data.providers?.gemini?.configured) }
            setProviderStatus(status)
            const registry = (data.models || fallbackExtractionModels) as Record<string, { models?: string[]; default_model?: string }>
            const nextModels: Record<ExtractionProvider, string[]> = {
                openai: Array.isArray(registry.openai?.models) ? [...registry.openai.models] : [...fallbackExtractionModels.openai],
                claude: Array.isArray(registry.claude?.models) ? [...registry.claude.models] : [...fallbackExtractionModels.claude],
                gemini: Array.isArray(registry.gemini?.models) ? [...registry.gemini.models] : [...fallbackExtractionModels.gemini],
            }
            setExtractionModels(nextModels)
            if (!extractionProvider && status.gemini) {
                setExtractionProvider("gemini")
                setExtractionModel(nextModels.gemini[0])
            }
        }).catch(() => {})
    }, [])

    const uploadFile = async (file: File) => {
        const extension = file.name.split(".").pop()?.toLowerCase()
        if (!extension || !["pdf", "docx", "txt"].includes(extension)) {
            setError("Choose a PDF, DOCX, or TXT resume.")
            return
        }
        if (file.size > 10 * 1024 * 1024) {
            setError("Resume must be 10 MB or smaller.")
            return
        }
        setUploading(true); setNotice(""); setError("")
        try {
            if (!extractionProvider || !extractionModel || !providerStatus[extractionProvider]) { setError("Select a configured provider and model before uploading your resume."); return }
            const form = new FormData(); form.append("file", file); form.append("provider", extractionProvider); form.append("model", extractionModel)
            let response: Response
            try { response = await fetch(`${api}/resume`, { method: "POST", body: form }) }
            catch { throw new Error("Could not reach the profile service. Check that the backend API and MongoDB are running.") }
            const data = await readApiResponse(response, "Resume upload failed")
            setProfile({ ...blank, ...data })
            setNotice(data.extraction_status === "complete"
                ? "Resume parsed into profile fields. Review the details and save your profile."
                : data.extraction_status === "partial"
                    ? "Resume text was extracted and some fields were recognized. For full AI extraction, add OPENAI_API_KEY or GEMINI_API_KEY to backend/.env, restart the API, then upload again."
                    : "Resume text was extracted, but no profile fields were recognized. For AI extraction, add OPENAI_API_KEY or GEMINI_API_KEY to backend/.env and restart the API, or enter the fields manually.")
        } catch (e) {
            setError(e instanceof Error ? e.message : "Resume upload failed.")
        } finally {
            setUploading(false)
        }
    }
    const uploadResume = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (file) void uploadFile(file)
    }

    const save = async () => {
        const missing: string[] = []
        if (!profile.skills.length) missing.push("at least one skill")
        if (!profile.job_preference) missing.push("a work preference")
        if (!profile.preferred_locations.length) missing.push("at least one preferred location")
        if (missing.length) {
            setError(`Complete the required profile fields: ${missing.join(", ")}. Granular constraints and preferences are optional.`)
            document.getElementById("competencies")?.scrollIntoView({ behavior: "smooth", block: "center" })
            return
        }
        setSaving(true); setError(""); setNotice("")
        try {
            let response: Response
            try { response = await fetch(api, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) }) }
            catch { throw new Error("Could not reach the profile service. Check that the backend API and MongoDB are running.") }
            const data = await readApiResponse(response, "Could not save profile")
            setProfile({ ...blank, ...data })
            setNotice("")
            setSavedToast(true)
            window.setTimeout(() => setSavedToast(false), 2200)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save profile.")
        } finally {
            setSaving(false)
        }
    }

    if (loading) return (
        <div className="h-screen flex items-center justify-center text-zinc-500">
            <LoaderCircle className="w-8 h-8 animate-spin" />
        </div>
    )

    const sections = [
        { id: "identity", label: "Name", done: Boolean(profile.name.trim()) },
        { id: "summary", label: "Summary", done: Boolean(profile.profile_summary.trim()) },
        { id: "competencies", label: "Skills & preferences", done: profile.skills.length > 0 && Boolean(profile.job_preference) && profile.preferred_locations.length > 0 },
        { id: "compensation", label: "Details & links", done: Boolean(profile.address || profile.preferred_locations.length || profile.linkedin_url || profile.github_url) },
        { id: "work-history", label: "Experience", done: profile.work_experience.length > 0 },
        { id: "education", label: "Education", done: profile.education.length > 0 },
        { id: "projects", label: "Projects & credentials", done: profile.projects.length > 0 || profile.certifications.length > 0 },
    ]
    const completedSections = sections.filter((section) => section.done).length

    return (
        <div className="profile-page mx-auto max-w-5xl space-y-8 p-6 md:p-8 pb-32">
            {savedToast && <div role="status" className="fixed bottom-6 right-6 z-50 border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg">Saved</div>}

            {/* Header */}
            <header className="flex items-center gap-5 border-b pb-6">
                <div className="flex h-16 w-16 items-center justify-center bg-zinc-900 shadow-md border">
                    <UserRound className="h-8 w-8 text-white" />
                </div>
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">Career Profile</h1>
                    <p className="mt-1 text-sm text-zinc-500 font-medium tracking-wide text-balance">
                        Configure your background once. Prepy natively queries this to optimize your job attack plan.
                    </p>
                </div>
            </header>

            {error && <div className="border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 flex items-center gap-2"><X className="w-4 h-4" />{error}</div>}
            {notice && <div className="border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</div>}

            <section className="border border-zinc-200 bg-white p-4 shadow-sm md:p-5" aria-label="Profile progress">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-zinc-900">Profile progress</span><span className="text-zinc-500">{completedSections} of {sections.length} sections started</span></div>
                <div className="mt-3 h-1.5 bg-zinc-100"><div className="h-full bg-zinc-900 transition-all" style={{ width: `${(completedSections / sections.length) * 100}%` }} /></div>
                <nav aria-label="Jump to profile section" className="mt-4 flex gap-2 overflow-x-auto pb-1">{sections.map((section) => <a key={section.id} href={`#${section.id}`} className={`shrink-0 border px-3 py-2 text-xs font-medium transition-colors hover:border-zinc-900 ${section.done ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600"}`}>{section.label}</a>)}</nav>
            </section>

            {/* Resume Upload Module */}
            <section className={sectionClass}>
                <div>
                    <h2 className="text-lg font-bold tracking-tight text-zinc-900">Auto-Extract via Resume</h2>
                    <p className="mt-1 text-sm text-zinc-500 font-medium">Instantly populate these fields by supplying your latest PDF, DOCX, or TXT.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div><label htmlFor="resume-provider" className={labelClass}>Extraction provider</label><SearchableSelect id="resume-provider" value={extractionProvider} onChange={(value) => { setExtractionProvider(value as ExtractionProvider); setExtractionModel("") }} placeholder="Search providers" options={(["openai", "claude", "gemini"] as ExtractionProvider[]).map((id) => ({ value: id, label: `${id === "openai" ? "OpenAI" : id === "claude" ? "Claude" : "Gemini"}${providerStatus[id] ? " · ready" : " · add key in LLM settings"}` }))} /></div>
                    <div><label htmlFor="resume-model" className={labelClass}>Extraction model</label><SearchableSelect id="resume-model" value={extractionModel} disabled={!extractionProvider} onChange={setExtractionModel} placeholder="Search models" options={extractionProvider ? extractionModels[extractionProvider].map((id) => ({ value: id, label: id })) : []} /></div>
                </div>
                {extractionProvider && !providerStatus[extractionProvider] && <p className="text-xs text-amber-700">Add this provider’s API key in <a href="/llm-settings" className="font-semibold underline underline-offset-2">LLM settings</a> before extracting.</p>}
                <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,application/pdf" onChange={uploadResume} className="sr-only" />

                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || !extractionProvider || !extractionModel || !providerStatus[extractionProvider]} onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={(e) => { e.preventDefault(); setDragActive(false); const file = e.dataTransfer.files[0]; if (file) void uploadFile(file) }} className={`group relative flex w-full flex-col items-center justify-center gap-3 border-2 border-dashed p-10 transition-colors disabled:opacity-50 ${dragActive ? "border-zinc-900 bg-zinc-100" : "border-zinc-300 bg-zinc-50/50 hover:border-zinc-500 hover:bg-zinc-50"}`}>
                    {uploading ? <LoaderCircle className="h-8 w-8 text-zinc-400 animate-spin" /> : <Upload className="h-8 w-8 text-zinc-400 group-hover:text-zinc-600 transition-colors" />}
                    <div className="text-center">
                        <p className="text-sm font-bold text-zinc-800">{uploading ? "Reading your resume…" : "Choose a resume or drop it here"}</p>
                        <p className="mt-1 text-xs text-zinc-500">PDF, DOCX, or TXT · Up to 10 MB. You can also fill in every section manually below.</p>
                    </div>
                </button>
                {profile.resume_filename && <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 inline-flex px-3 py-1.5 border border-emerald-200"><FileText className="h-3.5 w-3.5" /> Attached: {profile.resume_filename}</p>}
            </section>

            <section id="identity" className={sectionClass}>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900">Personal details</h2>
                <div className="max-w-xl space-y-1">
                    <label htmlFor="profile-name" className={labelClass}>Full name</label>
                    <input id="profile-name" value={profile.name} onChange={(event) => update("name", event.target.value)} placeholder="Your name, as it appears on your resume" className={inputClass} />
                    <p className="text-xs text-zinc-500">We’ll use this to personalize your AI conversations. Resume uploads can fill it in automatically.</p>
                </div>
            </section>

            {/* Summary */}
            <section id="summary" className={sectionClass}>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900">Executive Summary</h2>
                <div>
                    <textarea
                        value={profile.profile_summary}
                        onChange={(e) => update("profile_summary", e.target.value)}
                        rows={4}
                        placeholder="Detail your overarching experience and career goals..."
                        className={inputClass}
                    />
                </div>
            </section>

            {/* Core Competencies */}
            <section id="competencies" className={sectionClass}>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900 border-b pb-3">Competencies & Preferences</h2>
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="md:col-span-2 space-y-1">
                        <label className={labelClass}>Technical & Soft Skills <span className="text-red-600">*</span></label>
                        <SharpMultiSelect
                            value={profile.skills}
                            onChange={(v) => update("skills", v)}
                            options={skillsCatalog}
                            placeholder="Type to search or add custom skills..."
                        />
                    </div>

                    <div className="space-y-1">
                        <label className={labelClass}>Work arrangement <span className="text-red-600">*</span></label>
                        <SharpSingleSelect value={profile.job_preference} onChange={(v) => update("job_preference", v)} placeholder="Search or add a work arrangement…" options={["Remote", "Hybrid", "On-site", "Flexible", "Any / Open"]} />
                    </div>

                    <div className="space-y-1">
                        <label className={labelClass}>Preferred locations <span className="text-red-600">*</span></label>
                        <SharpMultiSelect
                            value={profile.preferred_locations}
                            onChange={(v) => update("preferred_locations", v)}
                            placeholder="Add cities, states, or countries..."
                        />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                        <label className={labelClass}>Granular Constraints & Preferences <span className="font-normal normal-case text-zinc-400">(optional)</span></label>
                        <SharpMultiSelect
                            value={profile.additional_preferences}
                            onChange={(v) => update("additional_preferences", v)}
                            placeholder="e.g. Visa sponsorship required, no crypto companies, strong engineering culture..."
                        />
                    </div>
                </div>
            </section>

            {/* Compensation & Socials */}
            <section id="compensation" className={sectionClass}>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900 border-b pb-3">Address, compensation & links</h2>
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-1">
                        <label className={labelClass}>Current location / address</label>
                        <input value={profile.address} onChange={(e) => update("address", e.target.value)} placeholder="City, state, country" className={inputClass} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>Current CTC <span className="font-normal text-zinc-500">(annual)</span></label>
                        <div className="flex items-center border border-zinc-300 bg-white focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900"><span className="border-r border-zinc-200 px-3 py-2 text-sm text-zinc-500">₹</span><input inputMode="decimal" value={profile.current_ctc} onChange={(e) => update("current_ctc", e.target.value)} placeholder="18 LPA or 18,00,000" className="w-full px-3 py-2 text-sm outline-none" /></div>
                        <p className="text-xs text-zinc-500">Enter annual compensation in INR, such as 18 LPA.</p>
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>Expected CTC <span className="font-normal text-zinc-500">(annual)</span></label>
                        <div className="flex items-center border border-zinc-300 bg-white focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900"><span className="border-r border-zinc-200 px-3 py-2 text-sm text-zinc-500">₹</span><input inputMode="decimal" value={profile.expected_ctc} onChange={(e) => update("expected_ctc", e.target.value)} placeholder="24 LPA or 24,00,000" className="w-full px-3 py-2 text-sm outline-none" /></div>
                        <p className="text-xs text-zinc-500">Enter your expected annual compensation in INR.</p>
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>LinkedIn Address</label>
                        <input type="url" value={profile.linkedin_url} onChange={(e) => update("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/" className={inputClass} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>GitHub Handle</label>
                        <input type="url" value={profile.github_url} onChange={(e) => update("github_url", e.target.value)} placeholder="https://github.com/" className={inputClass} />
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>LeetCode profile <span className="font-normal text-zinc-500">(optional)</span></label>
                        <input type="url" value={profile.leetcode_url} onChange={(e) => update("leetcode_url", e.target.value)} placeholder="https://leetcode.com/u/" className={inputClass} />
                    </div>
                </div>
            </section>

            {/* Professional Experience */}
            <section id="work-history" className={sectionClass}>
                <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <h2 className="text-lg font-bold tracking-tight text-zinc-900">Work History</h2>
                    <button type="button" onClick={() => update("work_experience", [...profile.work_experience, emptyExperience()])} className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-300 font-semibold px-3 py-1.5 text-xs transition-colors shadow-sm">
                        <Plus className="h-3.5 w-3.5" /> ADD ROLE
                    </button>
                </div>

                <div className="space-y-8">
                    {profile.work_experience.map((item, i) => (
                        <div key={i} className="relative group bg-zinc-50/50 border p-5">
                            <button type="button" onClick={() => update("work_experience", profile.work_experience.filter((_, n) => n !== i))} className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors bg-white">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="grid gap-5 md:grid-cols-2 pr-12 mb-4">
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Job Title</label><input value={item.title} onChange={(e) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, title: e.target.value } : x))} placeholder="E.g. Senior Engineer" className={inputClass} /></div>
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Company</label><input value={item.company} onChange={(e) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, company: e.target.value } : x))} placeholder="Company Name" className={inputClass} /></div>
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Dates employed</label><div className="grid grid-cols-2 gap-2"><CalendarDatePicker value={item.start_date} onChange={(date) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, start_date: date } : x))} placeholder="Start date" /><CalendarDatePicker value={item.end_date === "Present" ? "" : item.end_date} onChange={(date) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, end_date: date } : x))} placeholder="End date" /></div><label className="mt-2 flex items-center gap-2 text-xs text-zinc-600"><input type="checkbox" checked={item.end_date === "Present"} onChange={(e) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, end_date: e.target.checked ? "Present" : "" } : x))} />I currently work here</label></div>
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Location</label><input value={item.location} onChange={(e) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, location: e.target.value } : x))} placeholder="City or Remote" className={inputClass} /></div>
                            </div>
                            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Measurable Impact & Scope</label><textarea value={item.description} onChange={(e) => update("work_experience", profile.work_experience.map((x, n) => n === i ? { ...x, description: e.target.value } : x))} rows={4} placeholder="Engineered high-throughput service resulting in..." className={inputClass} /></div>
                        </div>
                    ))}
                    {profile.work_experience.length === 0 && <p className="text-sm text-zinc-500 italic py-4 text-center">No experience logged. Add a role to improve accuracy.</p>}
                </div>
            </section>

            {/* Education */}
            <section id="education" className={sectionClass}>
                <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <h2 className="text-lg font-bold tracking-tight text-zinc-900">Academic Background</h2>
                    <button type="button" onClick={() => update("education", [...profile.education, emptyEducation()])} className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-300 font-semibold px-3 py-1.5 text-xs transition-colors shadow-sm">
                        <Plus className="h-3.5 w-3.5" /> ADD DEGREE
                    </button>
                </div>
                <div className="space-y-5">
                    {profile.education.map((item, i) => (
                        <div key={i} className="relative group bg-zinc-50/50 border p-5 grid gap-4 md:grid-cols-2">
                            <button type="button" onClick={() => update("education", profile.education.filter((_, n) => n !== i))} className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors bg-white">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="space-y-1 pr-8"><label className="text-xs font-semibold uppercase text-zinc-500">Institution</label><input value={item.institution} onChange={(e) => update("education", profile.education.map((x, n) => n === i ? { ...x, institution: e.target.value } : x))} className={inputClass} /></div>
                            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Degree Focus</label><input value={item.degree} onChange={(e) => update("education", profile.education.map((x, n) => n === i ? { ...x, degree: e.target.value } : x))} className={inputClass} /></div>
                            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Field / Major</label><input value={item.field_of_study} onChange={(e) => update("education", profile.education.map((x, n) => n === i ? { ...x, field_of_study: e.target.value } : x))} className={inputClass} /></div>
                            <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Dates attended</label><div className="grid grid-cols-2 gap-2"><CalendarDatePicker value={item.start_date} onChange={(date) => update("education", profile.education.map((x, n) => n === i ? { ...x, start_date: date } : x))} placeholder="Start date" /><CalendarDatePicker value={item.end_date} onChange={(date) => update("education", profile.education.map((x, n) => n === i ? { ...x, end_date: date } : x))} placeholder="End date" /></div></div>
                        </div>
                    ))}
                    {profile.education.length === 0 && <p className="text-sm text-zinc-500 italic py-2 text-center">No degrees listed.</p>}
                </div>
            </section>

            {/* Projects */}
            <section id="projects" className={sectionClass}>
                <div className="flex items-center justify-between border-b pb-3 mb-4">
                    <h2 className="text-lg font-bold tracking-tight text-zinc-900">Projects & Portfolio</h2>
                    <button type="button" onClick={() => update("projects", [...profile.projects, emptyProject()])} className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 border border-zinc-300 font-semibold px-3 py-1.5 text-xs transition-colors shadow-sm">
                        <Plus className="h-3.5 w-3.5" /> ADD PROJECT
                    </button>
                </div>
                <div className="space-y-5">
                    {profile.projects.map((item, i) => (
                        <div key={i} className="relative group bg-zinc-50/50 border p-5">
                            <button type="button" onClick={() => update("projects", profile.projects.filter((_, n) => n !== i))} className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors bg-white">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="grid gap-4 md:grid-cols-2 pr-12 mb-4">
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Project Name</label><input value={item.name} onChange={(e) => update("projects", profile.projects.map((x, n) => n === i ? { ...x, name: e.target.value } : x))} className={inputClass} /></div>
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Live URL / Repo</label><input value={item.url} onChange={(e) => update("projects", profile.projects.map((x, n) => n === i ? { ...x, url: e.target.value } : x))} className={inputClass} /></div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Tech Stack</label>
                                    <SharpMultiSelect value={item.technologies} onChange={(v) => update("projects", profile.projects.map((x, n) => n === i ? { ...x, technologies: v } : x))} placeholder="E.g. React, Postgres, Stripe..." />
                                </div>
                                <div className="space-y-1"><label className="text-xs font-semibold uppercase text-zinc-500">Overview</label><textarea value={item.description} onChange={(e) => update("projects", profile.projects.map((x, n) => n === i ? { ...x, description: e.target.value } : x))} rows={2} className={inputClass} /></div>
                            </div>
                        </div>
                    ))}
                    {profile.projects.length === 0 && <p className="text-sm text-zinc-500 italic py-2 text-center">No projects listed.</p>}
                </div>
            </section>

            {/* Certifications */}
            <section className={sectionClass}>
                <h2 className="text-lg font-bold tracking-tight text-zinc-900 border-b pb-3 mb-4">Certifications</h2>
                <div className="space-y-1">
                    <SharpMultiSelect
                        value={profile.certifications}
                        onChange={(v) => update("certifications", v)}
                        placeholder="Add licenses or certifications..."
                    />
                </div>
            </section>

            <footer className="flex flex-col gap-4 border-t border-zinc-200 bg-white py-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-zinc-500">Save when you’ve finished reviewing your details.</p>
                <button type="button" onClick={save} disabled={saving || uploading} className="flex items-center justify-center gap-2 bg-zinc-900 px-8 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors">
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? "Saving profile…" : "Save profile"}
                </button>
            </footer>
        </div>
    )
}
