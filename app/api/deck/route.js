// /api/deck — manage the founder's pitch-deck library.
//   GET    -> list decks
//   POST   -> upload a deck (multipart: deck file, label, tags, is_default)
//   PATCH  -> set the default deck ({ id })
//   DELETE -> remove a deck ({ id })
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { listDecks, addDeck, removeDeck, setDefaultDeck } from '@/lib/decks';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const MAX_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_EXT = ['pdf', 'ppt', 'pptx'];

// Don't leak absolute filesystem paths to the client.
function publicDeck(d) {
  const { path: _p, ...rest } = d;
  return { ...rest, filename: path.basename(d.path ?? '') };
}

export async function GET() {
  return NextResponse.json({ decks: listDecks().map(publicDeck) });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get('deck');
    if (!file || typeof file === 'string' || file.size === 0) {
      return NextResponse.json({ error: 'Please choose a deck file.' }, { status: 400 });
    }
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: 'Deck must be a PDF, PPT, or PPTX.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Deck must be 25MB or smaller.' }, { status: 400 });
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const safeName = `deck_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = path.join(UPLOAD_DIR, safeName);
    fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));

    const tags = String(form.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const deck = addDeck({
      label: String(form.get('label') ?? '') || file.name,
      path: filePath,
      mime: file.type || 'application/octet-stream',
      size_bytes: file.size,
      tags,
      is_default: form.get('is_default') === 'true',
    });
    return NextResponse.json({ ok: true, deck: publicDeck(deck) });
  } catch (err) {
    console.error('deck upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  const deck = setDefaultDeck(id);
  if (!deck) return NextResponse.json({ error: 'Deck not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, deck: publicDeck(deck) });
}

export async function DELETE(request) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  const removed = removeDeck(id);
  if (!removed) return NextResponse.json({ error: 'Deck not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
