import { NextRequest, NextResponse } from 'next/server';

const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam — deep, authoritative narrator
const MODEL_ID = 'eleven_multilingual_v2';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    return NextResponse.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
  }

  let text: string;
  try {
    const body = await req.json();
    text = body.text;
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text field' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.75,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      console.error('[TTS] ElevenLabs error:', res.status, errText);
      return NextResponse.json({ error: 'ElevenLabs API error' }, { status: 502 });
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('[TTS] Fetch error:', err);
    return NextResponse.json({ error: 'Failed to reach ElevenLabs' }, { status: 502 });
  }
}
