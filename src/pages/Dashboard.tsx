import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, Loader2, Eye, Send, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

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
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    },
  });

  const stats = {
    total: posts?.length || 0,
    published: posts?.filter((p) => p.status === "published").length || 0,
    ready: posts?.filter((p) => p.status === "ready").length || 0,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Generate and publish commodity market posts to LinkedIn
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => runWorkflow.mutate(false)}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Generate Post
          </Button>
          <Button
            onClick={() => runWorkflow.mutate(true)}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Generate & Publish
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Posts", value: stats.total, icon: RefreshCw },
          { label: "Ready to Publish", value: stats.ready, icon: Eye },
          { label: "Published", value: stats.published, icon: Send },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Posts List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Posts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !posts?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium">No posts yet</p>
              <p className="text-sm mt-1">Click "Generate Post" to create your first commodity market post.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
                >
                  {post.image_url && !post.image_url.startsWith("data:") && (
                    <img
                      src={post.image_url}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{post.title}</h3>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {post.content.substring(0, 100)}...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(post.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Badge className={statusColors[post.status] || ""} variant="secondary">
                    {post.status}
                  </Badge>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" asChild>
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

// Need to import Zap for the button
import { Zap } from "lucide-react";

export default Dashboard;
