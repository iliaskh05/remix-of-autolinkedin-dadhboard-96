import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Settings, Zap, ImageIcon, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/image-studio", label: "Image Studio", icon: ImageIcon },
  { to: "/settings", label: "Settings", icon: Settings },
];

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-sidebar-background text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="p-6 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Zap className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">LinkedIn AutoPost</h1>
            <p className="text-xs text-sidebar-foreground/60">Multi-tenant edition</p>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border space-y-2">
          {user && (
            <p className="text-xs text-sidebar-foreground/70 px-2 truncate">{user.email}</p>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
