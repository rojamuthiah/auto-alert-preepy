import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, BriefcaseBusiness, ExternalLink, LoaderCircle, Plus, Save, Trash2 } from "lucide-react"

type Row = { company: string; tier: string; priority: string; remarks: string; careers_page: string }
type Plan = { id: string; name: string; key: string; rows: Row[]; sources?: { title?: string; url: string; snippet?: string }[]; created_at: string }
const emptyRow = (): Row => ({ company: "", tier: "T3", priority: "Medium", remarks: "", careers_page: "-" })
const fields: { key: keyof Row; label: string }[] = [
    { key: "company", label: "Company" }, { key: "tier", label: "Tier" }, { key: "priority", label: "Priority" },
    { key: "remarks", label: "Notes" }, { key: "careers_page", label: "Careers page URL" },
]

export default function PlanDetailPage() {
    const { id = "" } = useParams()
    const [plan, setPlan] = useState<Plan | null>(null)
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    useEffect(() => {
        fetch(`/api/plans/${id}`).then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not load this plan.")
            setPlan(data)
        }).catch((e) => setError(e.message)).finally(() => setLoading(false))
    }, [id])

    const updateRow = (index: number, field: keyof Row, value: string) => setPlan((current) => current && ({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, [field]: value } : row) }))
    const save = async () => {
        if (!plan) return
        setSaving(true); setError(""); setNotice("")
        try {
            const response = await fetch(`/api/plans/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: plan.name, key: plan.key, rows: plan.rows }) })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data.detail || "Could not save this plan.")
            setPlan(data); setNotice("Plan changes saved.")
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save this plan.") }
        finally { setSaving(false) }
    }

    if (loading) return <div className="flex min-h-screen items-center justify-center text-zinc-500"><LoaderCircle className="h-6 w-6 animate-spin" /></div>
    if (error && !plan) return <div className="p-10"><Link to="/" className="inline-flex items-center gap-2 text-sm text-zinc-600"><ArrowLeft className="h-4 w-4" /> Plans</Link><p role="alert" className="mt-8 text-sm text-red-700">{error}</p></div>
    if (!plan) return null
    return <div className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:px-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-6xl">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition hover:text-zinc-950"><ArrowLeft className="h-4 w-4" /> All plans</Link>
            <div className="mb-6 mt-7 flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-[min(100%,420px)] flex-1"><div className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500"><BriefcaseBusiness className="h-4 w-4" /> Job plan</div>
                    <label className="sr-only" htmlFor="plan-name">Plan name</label><input id="plan-name" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} className="w-full max-w-2xl border border-transparent bg-transparent text-3xl font-semibold tracking-tight text-zinc-950 outline-none focus:border-zinc-300 focus:bg-white" />
                    <label className="sr-only" htmlFor="plan-key">Plan key</label><input id="plan-key" value={plan.key} onChange={(e) => setPlan({ ...plan, key: e.target.value })} className="mt-1 w-full max-w-2xl border border-transparent bg-transparent text-sm text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white" />
                    <p className="mt-1 text-xs text-zinc-500">{plan.rows.length} / 200 target companies</p>
                </div>
                <div className="flex items-center gap-3"><span className="text-xs text-zinc-400">Created {new Date(plan.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save changes"}</button></div>
            </div>
            {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="mb-4 text-sm text-emerald-700">{notice}</p>}
            <div className="overflow-hidden border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3"><p className="text-sm font-semibold text-zinc-800">Target companies</p><button type="button" onClick={() => { if (plan.rows.length < 200) setPlan({ ...plan, rows: [...plan.rows, emptyRow()] }) }} disabled={plan.rows.length >= 200} className="inline-flex items-center gap-1.5 border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /> Add row</button></div>
                <p className="px-4 py-2 text-xs text-zinc-500">Edit cells directly. A careers page may be “-” when it could not be verified; you can add it later.</p>
                <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left"><thead className="bg-zinc-50"><tr>{fields.map((field) => <th key={field.key} className="border-b border-zinc-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{field.label}</th>)}<th className="border-b border-zinc-200 px-3 py-3" /></tr></thead>
                    <tbody>{plan.rows.map((row, index) => <tr key={index} className="border-b border-zinc-100 last:border-0">
                        {fields.map((field) => <td key={field.key} className="p-1.5">{field.key === "tier" || field.key === "priority" ? <select aria-label={`${field.label} row ${index + 1}`} value={row[field.key]} onChange={(e) => updateRow(index, field.key, e.target.value)} className="w-full min-w-20 border border-zinc-200 bg-white px-2 py-2 text-sm outline-none focus:border-zinc-500">{(field.key === "tier" ? ["T1", "T2", "T3", "T4", "T5"] : ["High", "Medium", "Low"]).map((value) => <option key={value}>{value}</option>)}</select> : <input aria-label={`${field.label} row ${index + 1}`} value={row[field.key]} onChange={(e) => updateRow(index, field.key, e.target.value)} className="w-full min-w-32 border border-zinc-200 px-2.5 py-2 text-sm outline-none focus:border-zinc-500" />}</td>)}
                        <td className="px-2"><button type="button" aria-label={`Remove ${row.company || `row ${index + 1}`}`} onClick={() => setPlan({ ...plan, rows: plan.rows.filter((_, i) => i !== index) })} className="grid h-8 w-8 place-items-center text-zinc-400 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>)}</tbody>
                </table></div>
                {plan.rows.length === 0 && <div className="px-6 py-12 text-center text-sm text-zinc-500">No companies yet. Add a row to get started.</div>}
            </div>
            {plan.sources?.length ? <section className="mt-6 border border-zinc-200 bg-white p-5"><h2 className="text-sm font-semibold text-zinc-900">Research sources</h2><ul className="mt-3 grid gap-3 sm:grid-cols-2">{plan.sources.map((source, index) => <li key={`${source.url}-${index}`} className="min-w-0 border border-zinc-100 p-3"><a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">{source.title || source.url}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>{source.snippet && <p className="mt-1 text-xs leading-5 text-zinc-500">{source.snippet}</p>}</li>)}</ul></section> : null}
        </div>
    </div>
}
