"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetConversationsQueryOptions,
  getGetConversationQueryOptions,
  useSendMessage,
} from "@/api";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageSquare, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StoredUser {
  id: string; email: string; role: string;
  first_name?: string; last_name?: string;
}

export default function Messages() {
  const params = useParams<{ userId?: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [messageText, setMessageText] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>(params.userId ?? "");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw)); } catch { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (params.userId) setSelectedUserId(params.userId);
  }, [params.userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const { data: conversations = [], isLoading: convLoading } = useQuery({
    ...getGetConversationsQueryOptions(),
    enabled: !!user,
    refetchInterval: 5000,
  });

  const { data: thread = [], isLoading: threadLoading } = useQuery({
    ...getGetConversationQueryOptions(selectedUserId),
    enabled: !!user && !!selectedUserId,
    refetchInterval: 3000,
  });

  const sendMutation = useSendMessage();

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !selectedUserId) return;

    sendMutation.mutate({
      data: { recipient_id: selectedUserId, message_text: messageText.trim() },
    }, {
      onSuccess: () => {
        setMessageText("");
        queryClient.invalidateQueries({ queryKey: getGetConversationQueryOptions(selectedUserId).queryKey });
        queryClient.invalidateQueries({ queryKey: getGetConversationsQueryOptions().queryKey });
      },
      onError: () => toast({ variant: "destructive", title: "Failed to send message" }),
    });
  };

  const selectedConvo = (conversations as any[]).find((c: any) => c.other_user?.id === selectedUserId);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#F7F7F7] flex flex-col">
      <NavBar />

      <div className="flex-1 flex max-w-6xl mx-auto w-full px-4 py-6 gap-5 h-[calc(100vh-4rem)] overflow-hidden">
        {/* Conversation list */}
        <div className={`w-full md:w-80 flex-shrink-0 bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden flex flex-col ${selectedUserId ? "hidden md:flex" : "flex"}`}>
          <div className="p-4 border-b border-[#EBEBEB]">
            <h2 className="font-bold text-lg">Messages</h2>
          </div>

          <div className="flex-1 overflow-y-auto">
            {convLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/2" />
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (conversations as any[]).length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No conversations yet</p>
                <p className="text-xs mt-1">Message a landlord from a property listing</p>
              </div>
            ) : (
              (conversations as any[]).map((convo: any) => {
                const other = convo.other_user;
                const isActive = other?.id === selectedUserId;
                return (
                  <button
                    key={other?.id}
                    className="w-full text-left px-4 py-3 hover:bg-[#F7F7F7] transition-colors border-b border-[#EBEBEB] last:border-0"
                    style={{ background: isActive ? "#FFF0F0" : undefined }}
                    onClick={() => { setSelectedUserId(other?.id); router.push(`/messages/${other?.id}`); }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
                          {other?.first_name?.[0] ?? other?.role?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        {convo.unread_count > 0 && (
                          <div className="absolute -top-1 -right-1 h-4 w-4 bg-primary rounded-full text-white text-xs flex items-center justify-center">
                            {convo.unread_count}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-center">
                          <p className="text-sm font-semibold truncate">
                            {other?.first_name} {other?.last_name}
                          </p>
                          {convo.last_message_at && (
                            <span className="text-xs text-muted-foreground shrink-0 ml-2">
                              {new Date(convo.last_message_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{convo.last_message}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Message thread */}
        <div className={`flex-1 bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden flex flex-col ${!selectedUserId ? "hidden md:flex" : "flex"}`}>
          {!selectedUserId ? (
            <div className="flex-1 flex items-center justify-center text-center p-8">
              <div>
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-muted-foreground">Select a conversation to start messaging</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="p-4 border-b border-[#EBEBEB] flex items-center gap-3">
                <button className="md:hidden mr-1" onClick={() => { setSelectedUserId(""); router.push("/messages"); }}>
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {selectedConvo?.other_user?.first_name?.[0] ?? "?"}
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {selectedConvo?.other_user?.first_name} {selectedConvo?.other_user?.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {selectedConvo?.other_user?.role?.replace("_", " ")}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {threadLoading ? (
                  <div className="flex justify-center">
                    <div className="text-sm text-muted-foreground">Loading messages...</div>
                  </div>
                ) : (thread as any[]).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <MessageSquare className="h-10 w-10 mb-2 opacity-20" />
                    <p className="text-sm text-muted-foreground">No messages yet. Say hello!</p>
                  </div>
                ) : (
                  (thread as any[]).map((msg: any) => {
                    const isMe = msg.sender_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                        {!isMe && (
                          <div className="h-7 w-7 rounded-full bg-[#EBEBEB] flex items-center justify-center text-xs font-bold mr-2 shrink-0 self-end">
                            {msg.sender?.first_name?.[0] ?? "?"}
                          </div>
                        )}
                        <div
                          className="max-w-[72%] rounded-2xl px-4 py-2.5 text-sm"
                          style={{
                            background: isMe ? "#FF5A5F" : "#F7F7F7",
                            color: isMe ? "#fff" : "#222",
                            borderBottomRightRadius: isMe ? "4px" : "16px",
                            borderBottomLeftRadius: isMe ? "16px" : "4px",
                          }}
                        >
                          <p>{msg.message_text}</p>
                          <p className="text-xs mt-1" style={{ opacity: 0.7 }}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {isMe && msg.read_at && " · Read"}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <form onSubmit={handleSend} className="p-4 border-t border-[#EBEBEB] flex gap-2">
                <Input
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-full bg-[#F7F7F7] border-[#EBEBEB]"
                  autoComplete="off"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full shrink-0"
                  style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                  disabled={!messageText.trim() || sendMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}