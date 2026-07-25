import { NextResponse } from "next/server";

// Placeholder for email verification callback (if enabled later)
export async function GET() {
  return NextResponse.redirect(new URL("/documents", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"));
}
