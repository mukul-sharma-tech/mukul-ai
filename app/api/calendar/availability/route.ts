import { NextRequest, NextResponse } from 'next/server';
import { getAvailableSlots } from '@/lib/calendar';

// GET /api/calendar/availability?date=2026-06-10
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Provide date as YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const slots = await getAvailableSlots(date);

    return NextResponse.json({ date, availableSlots: slots });
  } catch (error: any) {
    console.error('Calendar availability error:', error.message);
    return NextResponse.json(
      { error: 'Failed to fetch availability', details: error.message },
      { status: 500 },
    );
  }
}
