import { NextRequest, NextResponse } from 'next/server';
import { bookAppointment, checkFreeBusy } from '@/lib/calendar';

// POST /api/calendar/book
// Body: { date, time, name, email, purpose }
// time format: "10:30 AM IST" or "HH:MM" 24h
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, time, name, email, purpose } = body;

    if (!date || !time || !name) {
      return NextResponse.json(
        { error: 'date, time, and name are required' },
        { status: 400 },
      );
    }

    // Parse time → ISO datetime in IST
    const startISO = parseToISO(date, time);
    const endISO   = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();

    // Double-check the slot is still free
    const busy = await checkFreeBusy(startISO, endISO);
    if (busy.length > 0) {
      return NextResponse.json(
        { error: 'That slot is no longer available. Please choose another.' },
        { status: 409 },
      );
    }

    const event = await bookAppointment(
      `Call with ${name}`,
      purpose || `Booking via Mukul's AI Assistant\nFrom: ${name}${email ? ` (${email})` : ''}`,
      startISO,
      endISO,
      email,
    );

    return NextResponse.json({
      success:  true,
      message:  `Call booked for ${date} at ${time}!`,
      eventLink: event.htmlLink,
    });
  } catch (error: any) {
    console.error('Calendar booking error:', error.message);
    return NextResponse.json(
      { error: 'Booking failed', details: error.message },
      { status: 500 },
    );
  }
}

// Convert "10:30 AM IST" + "2026-06-10" → UTC ISO string
function parseToISO(date: string, time: string): string {
  // Normalize time: "10:30 AM IST" → "10:30"
  const clean = time.replace(/\s?(IST|AM|PM)/gi, '').trim();
  const isPM  = /PM/i.test(time);
  const isAM  = /AM/i.test(time);

  let [hours, minutes] = clean.split(':').map(Number);
  if (isPM && hours !== 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  // IST = UTC+5:30
  const utcHours   = hours - 5;
  const utcMinutes = minutes - 30;

  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCHours(utcHours, utcMinutes < 0 ? utcMinutes + 60 : utcMinutes, 0, 0);
  if (utcMinutes < 0) dt.setUTCHours(dt.getUTCHours() - 1);

  return dt.toISOString();
}
