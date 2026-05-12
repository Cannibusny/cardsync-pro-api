import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth, hasRole } from '../auth.jsx';

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '🏠', min: 'view_only' },
  { to: '/inventory', label: 'Inventory',  icon: '📦', min: 'view_only' },
  { to: '/pos',       label: 'POS',        icon: '💰', min: 'employee'  },
  { to: '/trade-ins', label: 'Trade-ins',  icon: '🔁', min: 'employee'  },
  { to: '/customers', label: 'Customers',  icon: '👥', min: 'view_only' },
  { to: '/grading',   label: 'Grading',    icon: '🏅', min: 'employee'  },
  { to: '/events',    label: 'Events',     icon: '🎟️', min: 'employee'  },
  { to: '/reports',   label: 'Reports',    icon: '📊', min: 'employee'  },
  { to: '/users',     label: 'Staff',      icon: '🛡️', min: 'manager'   },
  { to: '/settings',  label: 'Settings',   icon: '⚙️', min: 'manager'   },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-slate-100">
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="font-bold text-lg text-primary-700">CardSync Pro</div>
          <div className="text-xs text-slate-500 mt-0.5">Electronic Valet</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-1">
          {NAV.filter((n) => hasRole(user, n.min)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              <span>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-3 py-3">
          <div className="text-xs text-slate-500">Signed in as</div>
          <div className="text-sm font-medium text-slate-800 truncate">{user?.name || user?.email}</div>
          <div className="mt-0.5">
            <span className="badge-blue">{user?.role}</span>
          </div>
          <button onClick={onLogout} className="btn-ghost mt-3 w-full justify-start text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="font-bold text-primary-700">CardSync Pro</div>
          <button onClick={onLogout} className="btn-ghost text-xs">Sign out</button>
        </header>
        <main className="flex-1 overflow-x-auto">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
