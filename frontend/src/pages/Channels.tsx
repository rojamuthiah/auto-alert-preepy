import { FormEvent, useEffect, useState } from "react"
import { LoaderCircle, Mail, MessageSquareText, Plus, Send, Settings2, X } from "lucide-react"
import SearchableSelect from "../components/SearchableSelect"

type ChannelKind = "email" | "whatsapp"
type EmailChannel = { configured: boolean; smtp_host: string; smtp_port: number; security: "starttls" | "ssl" | "none"; username: string; from_name: string; from_email: string; recipient_email: string; enabled: boolean; notify_plan_updates: boolean }
type WhatsAppChannel = { configured: boolean; phone_number_id: string; recipient_phone: string; graph_version: string; notification_template: string; template_language: string; enabled: boolean; notify_plan_updates: boolean }
type EmailForm = Omit<EmailChannel, "configured"> & { password: string }
type WhatsAppForm = Omit<WhatsAppChannel, "configured"> & { access_token: string }

const emailDefaults: EmailForm = { smtp_host: "", smtp_port: 587, security: "starttls", username: "", password: "", from_name: "Prep Studio", from_email: "", recipient_email: "", enabled: true, notify_plan_updates: false }
const whatsappDefaults: WhatsAppForm = { phone_number_id: "", access_token: "", recipient_phone: "", graph_version: "v26.0", notification_template: "", template_language: "en_US", enabled: true, notify_plan_updates: false }
const inputClass = "w-full border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-900"
const labelClass = "mb-1.5 block text-xs font-semibold text-zinc-700"

async function readResponse(response: Response) {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || "The channel request failed.")
    return data
}

export default function ChannelsPage() {
    const [channels, setChannels] = useState<{ email: EmailChannel; whatsapp: WhatsAppChannel }>({
        email: { ...emailDefaults, configured: false },
        whatsapp: { ...whatsappDefaults, configured: false },
    })
    const [emailForm, setEmailForm] = useState(emailDefaults)
    const [whatsappForm, setWhatsappForm] = useState(whatsappDefaults)
    const [editing, setEditing] = useState<ChannelKind | null>(null)
    const [adding, setAdding] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [busy, setBusy] = useState<ChannelKind | null>(null)
    const [error, setError] = useState("")
    const [message, setMessage] = useState("")

    const load = async () => {
        const response = await fetch("/api/channels")
        const data = await readResponse(response)
        setChannels(data)
        setEmailForm((current) => ({ ...current, ...data.email, password: "" }))
        setWhatsappForm((current) => ({ ...current, ...data.whatsapp, access_token: "" }))
    }

    useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Could not load channels.")).finally(() => setLoading(false)) }, [])

    const openEditor = (kind: ChannelKind) => {
        setError(""); setMessage(""); setAdding(false); setEditing(kind)
        if (kind === "email") setEmailForm((current) => ({ ...current, ...channels.email, password: "" }))
        else setWhatsappForm((current) => ({ ...current, ...channels.whatsapp, access_token: "" }))
    }

    const saveEmail = async (event: FormEvent) => {
        event.preventDefault(); setSaving(true); setError(""); setMessage("")
        try {
            const response = await fetch("/api/channels/email", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...emailForm, smtp_port: Number(emailForm.smtp_port) }) })
            const data = await readResponse(response)
            setChannels((current) => ({ ...current, email: data.email }))
            setEmailForm((current) => ({ ...current, ...data.email, password: "" }))
            setEditing(null); setMessage("Email channel added.")
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save email channel.") }
        finally { setSaving(false) }
    }

    const saveWhatsApp = async (event: FormEvent) => {
        event.preventDefault(); setSaving(true); setError(""); setMessage("")
        try {
            const response = await fetch("/api/channels/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(whatsappForm) })
            const data = await readResponse(response)
            setChannels((current) => ({ ...current, whatsapp: data.whatsapp }))
            setWhatsappForm((current) => ({ ...current, ...data.whatsapp, access_token: "" }))
            setEditing(null); setMessage("WhatsApp channel added.")
        } catch (e) { setError(e instanceof Error ? e.message : "Could not save WhatsApp channel.") }
        finally { setSaving(false) }
    }

    const toggleChannel = async (kind: ChannelKind) => {
        setBusy(kind); setError(""); setMessage("")
        try {
            const enabled = !channels[kind].enabled
            await readResponse(await fetch(`/api/channels/${kind}/enabled`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }))
            setChannels((current) => ({ ...current, [kind]: { ...current[kind], enabled } }))
            setMessage(`${kind === "email" ? "Email" : "WhatsApp"} channel ${enabled ? "enabled" : "disabled"}.`)
        } catch (e) { setError(e instanceof Error ? e.message : `Could not update ${kind} status.`) }
        finally { setBusy(null) }
    }

    const sendTestEmail = async () => {
        setBusy("email"); setError(""); setMessage("")
        try {
            const data = await readResponse(await fetch("/api/channels/email/test", { method: "POST" }))
            setMessage(data.message || `Test email sent to ${channels.email.recipient_email}.`)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Could not send the test email.")
        } finally {
            setBusy(null)
        }
    }

    const renderStatus = (kind: ChannelKind) => {
        const channel = channels[kind]
        const isEmail = kind === "email"
        const Icon = isEmail ? Mail : MessageSquareText
        const destination = isEmail ? channels.email.recipient_email : channels.whatsapp.recipient_phone ? `+${channels.whatsapp.recipient_phone.replace(/^\+/, "")}` : ""
        return <section key={kind} className="border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
            <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center bg-zinc-100 text-zinc-700"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-zinc-900">{isEmail ? "Email" : "WhatsApp"}</h2><span className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${channel.configured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}><span className={`h-1.5 w-1.5 ${channel.configured ? "bg-emerald-500" : "bg-zinc-300"}`} />{channel.configured ? channel.enabled ? "Connected · enabled" : "Connected · paused" : "Not connected"}</span></div>
                    <p className="mt-1 break-all text-sm text-zinc-500">{channel.configured ? destination : isEmail ? "Send plan updates to an email address using your SMTP provider." : "Send plan updates through the official WhatsApp Cloud API."}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {!channel.configured && <button type="button" onClick={() => openEditor(kind)} className="inline-flex items-center gap-2 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white"><Plus className="h-3.5 w-3.5" />Add {isEmail ? "email" : "WhatsApp"}</button>}
                        {channel.configured && <>{isEmail && <button type="button" onClick={() => void sendTestEmail()} disabled={busy === "email"} className="inline-flex items-center gap-2 bg-zinc-950 px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy === "email" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send test email</button>}<button type="button" onClick={() => void toggleChannel(kind)} disabled={busy === kind} className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold disabled:opacity-50 ${channel.enabled ? "border border-zinc-300 text-zinc-700" : "bg-zinc-950 text-white"}`}>{busy === kind && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{channel.enabled ? "Disable" : "Enable"}</button><button type="button" onClick={() => openEditor(kind)} className="inline-flex items-center gap-2 border border-zinc-300 px-3.5 py-2.5 text-xs font-semibold text-zinc-700"><Settings2 className="h-3.5 w-3.5" />Edit details</button></>}
                    </div>
                </div>
            </div>
        </section>
    }

    return <div className="min-h-screen bg-[#f7f8fa] px-6 py-10 md:px-10"><div className="mx-auto max-w-5xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Channels</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Add Email or WhatsApp now. You can choose what to send through each channel later.</p></div><button type="button" onClick={() => setAdding((value) => !value)} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Add channel</button></div>
        {adding && <div className="mb-5 border border-zinc-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-zinc-900">Choose a channel to connect</p><button onClick={() => setAdding(false)} aria-label="Close channel choices" className="p-1 text-zinc-500"><X className="h-4 w-4" /></button></div><div className="flex flex-wrap gap-2">{(["email", "whatsapp"] as ChannelKind[]).filter((kind) => !channels[kind].configured).map((kind) => <button key={kind} onClick={() => openEditor(kind)} className="inline-flex items-center gap-2 border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">{kind === "email" ? <Mail className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}{kind === "email" ? "Email" : "WhatsApp"}</button>)}{(["email", "whatsapp"] as ChannelKind[]).every((kind) => channels[kind].configured) && <p className="text-sm text-zinc-500">Both available channels are connected. Use Edit to update either one.</p>}</div></div>}
        {error && <p role="alert" className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="mb-4 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {loading ? <div className="flex justify-center border border-zinc-200 bg-white py-16"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" /></div> : <div className="grid gap-4 lg:grid-cols-2">{renderStatus("email")}{renderStatus("whatsapp")}</div>}

        {editing === "email" && <form onSubmit={(event) => void saveEmail(event)} className="mt-5 border border-zinc-200 bg-white p-5 shadow-sm md:p-6"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-lg font-semibold text-zinc-900">Email delivery settings</h2><p className="mt-1 text-xs text-zinc-500">Use SMTP credentials from your mail provider. Gmail users can use an app password.</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Close email settings" className="p-1 text-zinc-500"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="email-host">SMTP host</label><input id="email-host" required value={emailForm.smtp_host} onChange={(e) => setEmailForm((current) => ({ ...current, smtp_host: e.target.value }))} placeholder="smtp.gmail.com" className={inputClass} /></div><div><label className={labelClass} htmlFor="email-port">Port</label><input id="email-port" type="number" min="1" max="65535" required value={emailForm.smtp_port} onChange={(e) => setEmailForm((current) => ({ ...current, smtp_port: Number(e.target.value) }))} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="email-security">Connection security</label><SearchableSelect id="email-security" value={emailForm.security} onChange={(value) => setEmailForm((current) => ({ ...current, security: value as EmailForm["security"] }))} placeholder="Choose security" options={[{ value: "starttls", label: "STARTTLS · port 587" }, { value: "ssl", label: "SSL/TLS · port 465" }, { value: "none", label: "None · local mail server" }]} /></div><div><label className={labelClass} htmlFor="email-username">SMTP username</label><input id="email-username" required autoComplete="username" value={emailForm.username} onChange={(e) => setEmailForm((current) => ({ ...current, username: e.target.value }))} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="email-password">SMTP password / app password</label><input id="email-password" type="password" autoComplete="new-password" required={!channels.email.configured} value={emailForm.password} onChange={(e) => setEmailForm((current) => ({ ...current, password: e.target.value }))} placeholder={channels.email.configured ? "Saved · leave blank to keep current password" : "Enter SMTP password"} className={inputClass} /></div><div><label className={labelClass} htmlFor="email-from-name">Sender name</label><input id="email-from-name" value={emailForm.from_name} onChange={(e) => setEmailForm((current) => ({ ...current, from_name: e.target.value }))} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="email-from">Sender email</label><input id="email-from" type="email" required value={emailForm.from_email} onChange={(e) => setEmailForm((current) => ({ ...current, from_email: e.target.value }))} className={inputClass} /></div><div><label className={labelClass} htmlFor="email-recipient">Send updates to</label><input id="email-recipient" type="email" required value={emailForm.recipient_email} onChange={(e) => setEmailForm((current) => ({ ...current, recipient_email: e.target.value }))} className={inputClass} /></div></div>
            <div className="mt-5 flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Save email channel</button><button type="button" onClick={() => setEditing(null)} className="border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700">Cancel</button></div>
        </form>}

        {editing === "whatsapp" && <form onSubmit={(event) => void saveWhatsApp(event)} className="mt-5 border border-zinc-200 bg-white p-5 shadow-sm md:p-6"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-lg font-semibold text-zinc-900">WhatsApp Cloud API settings</h2><p className="mt-1 text-xs text-zinc-500">Use a Meta WhatsApp Business phone number ID and access token. The test sends the official hello_world template.</p></div><button type="button" onClick={() => setEditing(null)} aria-label="Close WhatsApp settings" className="p-1 text-zinc-500"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="wa-phone-id">Phone number ID</label><input id="wa-phone-id" required value={whatsappForm.phone_number_id} onChange={(e) => setWhatsappForm((current) => ({ ...current, phone_number_id: e.target.value }))} className={inputClass} /></div><div><label className={labelClass} htmlFor="wa-recipient">Your WhatsApp number</label><input id="wa-recipient" required value={whatsappForm.recipient_phone} onChange={(e) => setWhatsappForm((current) => ({ ...current, recipient_phone: e.target.value }))} placeholder="+919876543210" className={inputClass} /></div>
                <div className="sm:col-span-2"><label className={labelClass} htmlFor="wa-token">Permanent access token</label><input id="wa-token" type="password" autoComplete="new-password" required={!channels.whatsapp.configured} value={whatsappForm.access_token} onChange={(e) => setWhatsappForm((current) => ({ ...current, access_token: e.target.value }))} placeholder={channels.whatsapp.configured ? "Saved · leave blank to keep current token" : "Paste Meta access token"} className={inputClass} /></div>
                <div><label className={labelClass} htmlFor="wa-version">Graph API version</label><input id="wa-version" required pattern="v[0-9]+\.0" value={whatsappForm.graph_version} onChange={(e) => setWhatsappForm((current) => ({ ...current, graph_version: e.target.value }))} className={inputClass} /></div></div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">This saves your WhatsApp Business Cloud API connection. Choose message types and templates later.</p>
            <div className="mt-5 flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Save WhatsApp channel</button><button type="button" onClick={() => setEditing(null)} className="border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700">Cancel</button></div>
        </form>}
    </div></div>
}
