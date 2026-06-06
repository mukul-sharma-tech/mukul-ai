import { calendar as googleCalendar, auth } from '@googleapis/calendar';

const CALENDAR_ID = 'muku0784@gmail.com';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getCalendarClient() {
  let credentials: any;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is set but contains invalid JSON');
    }
  } else {
    // Local fallback — read the file
    try {
      const fs   = require('fs');
      const path = require('path');
      const keyPath = path.join(process.cwd(), 'data', 'mukul-ai-c90455154a6f.json');
      credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    } catch {
      throw new Error('Calendar not configured: set GOOGLE_SERVICE_ACCOUNT_JSON environment variable on Vercel');
    }
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key');
  }

  const jwtClient = new auth.JWT({
    email:  credentials.client_email,
    key:    credentials.private_key,
    scopes: SCOPES,
  });

  return googleCalendar({ version: 'v3', auth: jwtClient });
}

// ── Check free/busy for a time range ─────────────────────
export async function checkFreeBusy(startTime: string, endTime: string) {
  const cal = getCalendarClient();
  const response = await cal.freebusy.query({
    requestBody: {
      timeMin:  startTime,
      timeMax:  endTime,
      timeZone: 'Asia/Kolkata',
      items:    [{ id: CALENDAR_ID }],
    },
  });
  return response.data.calendars?.[CALENDAR_ID]?.busy || [];
}

// ── Get available 30-min slots for a given date ──────────
export async function getAvailableSlots(dateISO: string): Promise<string[]> {
  // Working hours: 10am–7pm IST
  const start = new Date(`${dateISO}T04:30:00Z`); // 10am IST
  const end   = new Date(`${dateISO}T13:30:00Z`); // 7pm IST

  const busySlots = await checkFreeBusy(start.toISOString(), end.toISOString());

  const slots: string[] = [];
  const cursor = new Date(start);

  while (cursor < end) {
    const slotEnd = new Date(cursor.getTime() + 30 * 60 * 1000);

    const isBusy = busySlots.some((b: any) => {
      const bs = new Date(b.start);
      const be = new Date(b.end);
      return cursor < be && slotEnd > bs;
    });

    if (!isBusy) {
      // Format as "10:00 AM IST"
      slots.push(cursor.toLocaleTimeString('en-IN', {
        hour:     '2-digit',
        minute:   '2-digit',
        timeZone: 'Asia/Kolkata',
        hour12:   true,
      }) + ' IST');
    }

    cursor.setTime(cursor.getTime() + 30 * 60 * 1000);
  }

  return slots;
}

// ── Book an appointment ──────────────────────────────────
export async function bookAppointment(
  summary:     string,
  description: string,
  startTime:   string,
  endTime:     string,
  userEmail?:  string,
) {
  const cal = getCalendarClient();

  const eventBody: any = {
    summary,
    // Put user contact info in description instead of attendees (avoids Domain-Wide Delegation requirement)
    description: userEmail
      ? `${description}\n\nClient Email: ${userEmail}`
      : description,
    start: { dateTime: startTime, timeZone: 'Asia/Kolkata' },
    end:   { dateTime: endTime,   timeZone: 'Asia/Kolkata' },
    // No attendees array — service account can't invite without Domain-Wide Delegation
  };

  const response = await cal.events.insert({
    calendarId:  CALENDAR_ID,
    requestBody: eventBody,
    sendUpdates: 'none', // no invites sent, just creates on Mukul's calendar
  });

  return response.data;
}
