import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { Play, Loader2, Eye, Send, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  generating: "bg-accent/20 text-accent-foreground",
  ready: "bg-primary/10 text-primary",
  published: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
  failed: "bg-destructive/10 text-destructive",
};

const Dashboard = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isRunning, setIsRunning] = useState(false);

  const { data: posts, isLoading } = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const runWorkflow = useMutation({
    mutationFn: async (autoPublish: boolean) => {
      setIsRunning(true);
      const { data, error } = await supabase.functions.invoke("run-workflow", {
        body: { autoPublish },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Workflow completed!", description: `Post "${data.post?.title}" created successfully.` });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (error) => {
      toast({ title: "Workflow failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setIsRunning(false),
  });

  const publishPost = useMutation({
    mutationFn: async (postId: string) => {
      const { data, error } = await supabase.functions.invoke("publish-linkedin", {
        body: { postId },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Published!", description: "Post published to LinkedIn." });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to publish post.";
      const requiresReconnect = message.toLowerCase().includes("reconnect your account") || message.includes("LINKEDIN_TOKEN_EXPIRED");

      toast({
        title: requiresReconnect ? "LinkedIn reconnection required" : "Publish failed",
        description: requiresReconnect ? "Your LinkedIn session expired. Open Settings and reconnect, then retry." : message,
        variant: "destructive",
        action: requiresReconnect ? (
          <ToastAction altText="Open settings" onClick={() => navigate("/settings")}>
            Settings
          </ToastAction>
        ) : undefined,
      });

      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });

  const stats = {
    total: posts?.length || 0,
    published: posts?.filter((p) => p.status === "published").length || 0,
    ready: posts?.filter((p) => p.status === "ready").length || 0,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in-up">
      <div className="flex items-center justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Workspace</div>
          <h1 className="text-4xl font-semibold tracking-tight">
            Your <span className="text-gradient">content engine</span>
          </h1>
          <p className="text-muted-foreground mt-2">
            Generate, illustrate and publish posts to LinkedIn — on autopilot.
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => runWorkflow.mutate(false)}
            disabled={isRunning}
            className="border-border/60 bg-card/40 backdrop-blur hover:bg-card"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Generate Post
          </Button>
          <Button
            onClick={() => runWorkflow.mutate(true)}
            disabled={isRunning}
            className="relative overflow-hidden bg-gradient-to-r from-primary to-accent text-white hover:opacity-95 glow-primary group"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Generate & Publish
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Posts", value: stats.total, icon: RefreshCw, color: "from-blue-500/20 to-cyan-400/10", iconColor: "text-blue-400" },
          { label: "Ready to Publish", value: stats.ready, icon: Eye, color: "from-purple-500/20 to-pink-400/10", iconColor: "text-purple-400" },
          { label: "Published", value: stats.published, icon: Send, color: "from-emerald-500/20 to-teal-400/10", iconColor: "text-emerald-400" },
        ].map((stat) => (
          <Card key={stat.label} className="relative overflow-hidden border-border/50 bg-card/60 backdrop-blur-xl hover:border-border transition-colors">
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-50`} />
            <CardContent className="relative p-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-background/40 backdrop-blur border border-border/40 flex items-center justify-center">
                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
              </div>
              <div>
                <p className="text-3xl font-semibold tracking-tight">{stat.value}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Posts List */}
      <Card className="border-border/50 bg-card/60 backdrop-blur-xl">
        <CardHeader className="border-b border-border/40">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-primary to-accent" />
            Recent Posts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !posts?.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <p className="text-base font-medium text-foreground">No posts yet</p>
              <p className="text-sm mt-1">Click "Generate Post" to create your first one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="group flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-background/30 hover:bg-background/60 hover:border-border transition-all"
                >
                  {post.image_url && !post.image_url.startsWith("data:") ? (
                    <img
                      src={post.image_url}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover flex-shrink-0 ring-1 ring-border/50"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-lg flex-shrink-0 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-primary/70" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{post.title}</h3>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {post.content.substring(0, 100)}...
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {new Date(post.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Badge className={cn("capitalize border-0", statusColors[post.status] || "")} variant="secondary">
                    {post.status}
                  </Badge>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" asChild className="hover:bg-primary/10 hover:text-primary">
                      <Link to={`/post/${post.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    {post.status === "ready" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => publishPost.mutate(post.id)}
                        disabled={publishPost.isPending}
                        className="hover:bg-primary/10 hover:text-primary"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    )}
                    {post.status === "failed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => publishPost.mutate(post.id)}
                        disabled={publishPost.isPending}
                        title="Retry publishing"
                        className="hover:bg-destructive/10 hover:text-destructive"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

import { Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export default Dashboard;
