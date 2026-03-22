import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, List, GitCompareArrows, Lightbulb, Share2, MessageSquare, Menu, X } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/browse', icon: List, label: 'Browse' },
  { to: '/compare', icon: GitCompareArrows, label: 'Compare' },
  { to: '/recommend', icon: Lightbulb, label: 'Recommend' },
  { to: '/graph', icon: Share2, label: 'Graph' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
];

export default function Layout({ data, compareCount }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navContent = (
    <>
      <div className="p-4 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <span>ChipGraph</span>
        </h1>
        <p className="text-xs text-gray-500 mt-1">Espressif Competitive Intel</p>
      </div>

      <div className="flex-1 py-2">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-500'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
            {label === 'Compare' && compareCount > 0 && (
              <span className="ml-auto bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {compareCount}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="p-4 border-t border-gray-800 text-xs text-gray-600">
        <p>{data.allChips.length} chips</p>
        <p>{data.chipsByManufacturer.size} manufacturers</p>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-56 bg-gray-900 border-r border-gray-800 flex-col shrink-0">
        {navContent}
      </nav>

      {/* Mobile overlay sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <nav
            className="absolute inset-y-0 left-0 w-64 bg-gray-900 border-r border-gray-800 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end p-2">
              <button onClick={() => setSidebarOpen(false)} className="p-2 text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            {navContent}
          </nav>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="p-1 text-gray-400 hover:text-white">
            <Menu size={22} />
          </button>
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <span>⚡</span> ChipGraph
          </h1>
        </div>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
