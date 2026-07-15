"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, MessageSquare, ShieldCheck, Wallet, LogIn, AlertCircle } from "lucide-react";
import { customFetch } from "@/api/custom-fetch";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  related_id: string | null;
  related_type: string | null;
  read_at: string | null;
  created_at: string | null;
}

interface NotifPayload {
  unread_count: number;
  items: NotifItem[];
}

const POLL_MS = 30_000;

function IconForType({ type, className }: { type: string; className?: string }) {
  const I =
    type === "message"        ? MessageSquare :
    type === "escrow_release" ? Wallet :
    type === "login"          ? LogIn :
    type === "payment"        ? ShieldCheck :
                                AlertCircle;
  return <I className={className} />;
}

/**
 * The notification bell icon. Polls /api/notifications every 30s while the
 * user is signed in, shows an unread-count badge, and fires a toast for any
 * notification that arrives *after* the first poll (so the user doesn't get
 * a startup toast storm from old unread rows).
 */
export default function NotificationBell() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const seenRef = useRef<Set<string> | null>(null);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => customFetch<NotifPayload>("/api/notifications"),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const items = data?.items ?? [];
  const unread = data?.unread_count ?? 0;

  // First-fetch seed + subsequent-fetch toast. Runs on every poll so we
  // can pop toasts as soon as a new id appears.
  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(items.map((i) => i.id));
    if (seenRef.current === null) {
      // First poll: just record what's already there. Don't toast — the user
      // didn't miss these in real time.
      seenRef.current = currentIds;
      return;
    }
    const fresh = items.filter((i) => !seenRef.current!.has(i.id));
    if (fresh.length === 0) {
      seenRef.current = currentIds;
      return;
    }
    seenRef.current = currentIds;
    for (const n of fresh) {
      // Don't toast if the user is currently looking at the related view —
      // they'd see the change anyway. Cheap check: if it's a message and
      // the URL is /messages/<related_id>, skip.
      if (n.type === "message" && n.related_id && typeof window !== "undefined") {
        if (window.location.pathname === `/messages/${n.related_id}`) continue;
      }
      const onOpen = () => {
        if (n.type === "message" && n.related_id) router.push(`/messages/${n.related_id}`);
        else if (n.related_type === "booking" && n.related_id) router.push(`/bookings/${n.related_id}`);
        else router.push("/dashboard");
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      };
      toast({
        title: n.title,
        description: n.body ?? undefined,
        onClick: onOpen,
      });
    }
  }, [data, items, router, toast, queryClient]);

  const markAllRead = async () => {
    try {
      await customFetch("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      // best-effort; the next poll will retry the badge visually
    }
  };

  // When the popover opens, mark the visible batch as read so the badge
  // clears without forcing the user through a "Mark all read" click.
  useEffect(() => {
    if (open && unread > 0) {
      markAllRead();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const formatted = useMemo(
    () =>
      items.map((n) => ({
        ...n,
        when: n.created_at ? new Date(n.created_at).toLocaleString() : "",
      })),
    [items],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Notifications"
          className="relative h-10 w-10 rounded-full flex items-center justify-center hover:bg-[#F7F7F7] transition-colors"
        >
          <Bell className="h-5 w-5 text-foreground" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
              style={{ background: "#FF5A5F" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#EBEBEB]">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {formatted.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Bell className="h-6 w-6 mx-auto mb-2 opacity-30" />
              You're all caught up.
            </div>
          ) : (
            formatted.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (n.type === "message" && n.related_id) router.push(`/messages/${n.related_id}`);
                  else if (n.related_type === "booking" && n.related_id) router.push(`/bookings/${n.related_id}`);
                  else router.push("/dashboard");
                  setOpen(false);
                }}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-[#EBEBEB] last:border-0 hover:bg-[#F7F7F7] transition-colors ${!n.read_at ? "bg-[#FFF8F8]" : ""}`}
              >
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: !n.read_at ? "#FFF0F0" : "#F7F7F7" }}
                >
                  <IconForType type={n.type} className={`h-4 w-4 ${!n.read_at ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>}
                  <p className="text-[11px] text-muted-foreground mt-1">{n.when}</p>
                </div>
                {!n.read_at && (
                  <span className="h-2 w-2 rounded-full mt-2 shrink-0" style={{ background: "#FF5A5F" }} />
                )}
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#EBEBEB] bg-[#FAFAFA]">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => { setOpen(false); router.push("/dashboard"); }}
          >
            View all activity
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}