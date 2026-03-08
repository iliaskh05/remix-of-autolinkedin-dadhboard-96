import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Loader2 } from "lucide-react";

const PostDetail = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: post, isLoading } = useQuery({
    queryKey: ["post", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const publishPost = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("publish-linkedin", {
        body: { postId: id },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Published!", description: "Post published to LinkedIn." });
      queryClient.invalidateQueries({ queryKey: ["post", id] });
    },
    onError: (error) => {
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Post not found</p>
        <Button variant="ghost" asChild className="mt-4">
          <Link to="/"><ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Button variant="ghost" asChild className="mb-6">
        <Link to="/"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
      </Button>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Preview */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Post Preview</CardTitle>
              <Badge variant="secondary">{post.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {post.image_url && !post.image_url.startsWith("data:") && (
              <img
                src={post.image_url}
                alt="Post image"
                className="w-full rounded-lg object-cover aspect-video"
              />
            )}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.content}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Title:</span>
                <p className="font-medium">{post.title}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <p>{new Date(post.created_at).toLocaleString()}</p>
              </div>
              {post.published_at && (
                <div>
                  <span className="text-muted-foreground">Published:</span>
                  <p>{new Date(post.published_at).toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {post.news_summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">News Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{post.news_summary}</p>
              </CardContent>
            </Card>
          )}

          {post.status === "ready" && (
            <Button
              onClick={() => publishPost.mutate()}
              disabled={publishPost.isPending}
              className="w-full"
              size="lg"
            >
              {publishPost.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Publish to LinkedIn
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostDetail;
