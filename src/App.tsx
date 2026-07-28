import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import AuthGuard from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import PageLoader from "@/components/PageLoader";
import Layout from "./components/Layout";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Composer = lazy(() => import("./pages/Composer"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Settings = lazy(() => import("./pages/Settings"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const LinkedInCallback = lazy(() => import("./pages/LinkedInCallback"));
const ImageStudio = lazy(() => import("./pages/ImageStudio"));
const Auth = lazy(() => import("./pages/Auth"));
const Landing = lazy(() => import("./pages/Landing"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/linkedin/callback" element={<LinkedInCallback />} />
                <Route element={<AuthGuard><Layout /></AuthGuard>}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/composer" element={<Composer />} />
                  <Route path="/schedules" element={<Schedules />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/post/:id" element={<PostDetail />} />
                  <Route path="/image-studio" element={<ImageStudio />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
