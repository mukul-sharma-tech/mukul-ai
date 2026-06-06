import { NextResponse } from 'next/server';
import { getCommitHistory } from '@/lib/github';

export async function POST(request: Request) {
  try {
    const { project } = await request.json();
    if (!project) {
      return NextResponse.json({ message: 'Please provide a project name.' }, { status: 400 });
    }
    const result = await getCommitHistory(project);
    return NextResponse.json({ result });
  } catch (error: any) {
    console.error('GitHub commit API error:', error.message);
    return NextResponse.json({
      message: "Couldn't connect to GitHub's API right now.",
    });
  }
}
