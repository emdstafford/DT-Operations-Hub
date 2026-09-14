"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import NavBar from "@/components/NavBar";
import { supabase } from "@/lib/supabase";

const publicPaths = ["/login", "/auth/callback"];

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const isPublic = publicPaths.some((path) => pathname.startsWith(path));

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setChecking(false);
      if (!data.session && !isPublic) router.replace("/login");
      if (data.session && pathname === "/login") router.replace("/");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setChecking(false);
      if (!nextSession && !isPublic) router.replace("/login");
      if (nextSession && pathname === "/login") router.replace("/");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [isPublic, pathname, router]);

  if (checking) return <main className="auth-loading"><img src="https://cdn.prod.website-files.com/6493ca96ecc7e42995686bc5/68fbcce63d1ad0ff30d74399_Draft%20LogoDT.png" alt="Davenport Transportation" /><span>Loading DT Intelligence Hub…</span></main>;
  if (isPublic) return <>{children}</>;
  if (!session) return null;
  return <><NavBar />{children}</>;
}
