import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.redirect(`${config().app.baseUrl}/pay/done?state=cancelled`);
}
