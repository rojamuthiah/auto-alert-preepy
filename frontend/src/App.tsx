import { useEffect, useState } from "react"
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom"
import { Activity, Bell, BriefcaseBusiness, Cable, CircleUserRound, Command, Moon, Settings2, Sun, Workflow } from "lucide-react"
import ChatPage from "./pages/Chat"
import PlansPage from "./pages/JobPlans"
import PlanDetailPage from "./pages/PlanDetail"
import ProfilePage from "./pages/Profile"
import TracesPage from "./pages/Traces"
import { AlertsPage, LlmSettingsPage, WorkflowPage } from "./pages/WorkspacePages"
import ChannelsPage from "./pages/Channels"

const navigation = [
    { label: "Plans", to: "/", icon: BriefcaseBusiness },
    { label: "Alerts", to: "/alerts", icon: Bell },
    { label: "LLM settings", to: "/llm-settings", icon: Settings2 },
    { label: "Traces", to: "/traces", icon: Activity },
    { label: "Workflow", to: "/workflow", icon: Workflow },
    { label: "Channels", to: "/channels", icon: Cable },
]

function Layout({ children }: { children: React.ReactNode }) {
    const { pathname } = useLocation()
    const [darkTheme, setDarkTheme] = useState(() => localStorage.getItem("prep-studio-theme") === "dark")

    useEffect(() => {
        document.documentElement.classList.toggle("dark", darkTheme)
        localStorage.setItem("prep-studio-theme", darkTheme ? "dark" : "light")
    }, [darkTheme])

    return <div className="min-h-screen bg-[#f7f8fa] md:flex">
        <aside className="flex shrink-0 flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:h-screen md:w-[248px] md:border-b-0 md:border-r">
            <div className="flex h-[72px] items-center gap-3 border-b border-zinc-100 px-5"><span className="grid h-9 w-9 place-items-center bg-zinc-950 text-white"><Command className="h-4 w-4" /></span><span><b className="block text-sm tracking-tight text-zinc-950">Prep Studio</b><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Job search workspace</span></span></div>
            <div className="px-3 pt-6"><p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-400">Workspace</p><nav className="flex gap-1 overflow-x-auto pb-3 md:flex-col md:overflow-visible md:pb-0">{navigation.map(({ label, to, icon: Icon }) => <NavLink key={label} to={to} end={to === "/"} className={({ isActive }) => { const active = isActive || (label === "Plans" && pathname.startsWith("/plans")); return `group flex shrink-0 items-center gap-3 px-3 py-2.5 text-sm font-medium transition ${active ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}` }}><Icon className="h-4 w-4 shrink-0 opacity-80" /><span>{label}</span>{label === "Plans" && <span className="ml-auto hidden text-[10px] opacity-50 md:inline">01</span>}</NavLink>)}</nav></div>
            <div className="mt-auto grid grid-cols-2 gap-2 p-3">
                <Link to="/profile" className={`flex min-w-0 items-center justify-center gap-2 border px-2 py-2.5 text-xs font-medium transition ${pathname === "/profile" ? "border-zinc-950 bg-zinc-950 text-white shadow-sm" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`}><CircleUserRound className="h-4 w-4 shrink-0" /><span>Profile</span></Link>
                <button type="button" onClick={() => setDarkTheme((current) => !current)} aria-label={`Switch to ${darkTheme ? "light" : "dark"} theme`} className="flex min-w-0 items-center justify-center gap-2 border border-zinc-200 px-2 py-2.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950"><span className="grid h-4 w-4 shrink-0 place-items-center">{darkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</span><span>{darkTheme ? "Light" : "Dark"}</span></button>
            </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
    </div>
}

export default function App() {
    return <BrowserRouter><Layout><Routes>
        <Route path="/" element={<PlansPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/plans/create" element={<ChatPage />} />
        <Route path="/plans/create/:chatId" element={<ChatPage />} />
        <Route path="/plans/:id" element={<PlanDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/llm-settings" element={<LlmSettingsPage />} />
        <Route path="/traces" element={<TracesPage />} />
        <Route path="/workflow" element={<WorkflowPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="*" element={<PlansPage />} />
    </Routes></Layout></BrowserRouter>
}
