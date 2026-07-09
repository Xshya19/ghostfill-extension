/// <reference types="node" />

// Batch-labels a JSONL file of RawFieldRecords using an OpenAI-compatible chat
// endpoint, writing a labeled JSONL. Provider-agnostic via env vars:
//   GHOSTFILL_LLM_URL   (default below)
//   GHOSTFILL_LLM_KEY   (bearer token)
//   GHOSTFILL_LLM_MODEL (e.g. gpt-4o, claude-3-5-sonnet via a proxy)
//
// If GHOSTFILL_LLM_KEY is unset, runs in DRY-RUN mode: it prints the prompts it
// WOULD send (so you can inspect/distill offline) and exits without network.
//
// Usage:
//   tsx src/labeling/labelRunner.ts <input.jsonl> <output.jsonl> [batchSize]

import { readFileSync, writeFileSync } from 'node:fs';
import type { LabeledFieldRecord, RawFieldRecord } from '../../IntelligenceCore';
import { TEACHER_SYSTEM_PROMPT, buildUserPrompt } from './teacherPrompt';

const DEFAULT_URL = 'https://api.openai.com/v1/chat/completions';

function readJsonl(path: string): RawFieldRecord[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI labeling reads a caller-supplied dataset path.
  const raw = readFileSync(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((l: string) => l.trim())
    .map((l: string) => JSON.parse(l) as RawFieldRecord);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

interface TeacherLabel {
  idx: number;
  label: string;
  hardNegative: string | null;
  confidence: number;
  rationale: string;
}

async function callTeacher(batch: RawFieldRecord[]): Promise<TeacherLabel[]> {
  const key = process.env.GHOSTFILL_LLM_KEY;
  const url = process.env.GHOSTFILL_LLM_URL || DEFAULT_URL;
  const model = process.env.GHOSTFILL_LLM_MODEL || 'gpt-4o';
  const userPrompt = buildUserPrompt(batch);

  if (!key) {
    console.log('--- DRY RUN (no GHOSTFILL_LLM_KEY). Prompt that would be sent: ---');
    console.log('[system]\n' + TEACHER_SYSTEM_PROMPT);
    console.log('[user]\n' + userPrompt);
    return batch.map((_, i) => ({
      idx: i,
      label: 'Unknown',
      hardNegative: null,
      confidence: 0,
      rationale: 'dry-run placeholder',
    }));
  }

  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TEACHER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error('teacher HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return (parsed.labels || []) as TeacherLabel[];
}

async function main(): Promise<void> {
  const [, , inPath, outPath, batchSizeArg] = (process as any).argv;
  if (!inPath || !outPath) {
    console.error(
      'usage: tsx src/labeling/labelRunner.ts <input.jsonl> <output.jsonl> [batchSize]'
    );
    (process as any).exit(2);
  }
  const batchSize = Number(batchSizeArg || '20');
  const records = readJsonl(inPath);
  const batches = chunk(records, batchSize);
  const labeled: LabeledFieldRecord[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    if (!batch) {
      continue;
    }
    console.error(
      'labeling batch ' + (b + 1) + '/' + batches.length + ' (' + batch.length + ' fields)'
    );
    let labels: TeacherLabel[] = [];
    try {
      labels = await callTeacher(batch);
    } catch (err) {
      console.error('batch failed, marking Unknown: ' + (err as Error).message);
      labels = batch.map((_, i) => ({
        idx: i,
        label: 'Unknown',
        hardNegative: null,
        confidence: 0,
        rationale: 'teacher error',
      }));
    }
    const byIdx = new Map(labels.map((l) => [l.idx, l]));
    batch.forEach((rec, i) => {
      const l = byIdx.get(i);
      labeled.push({
        ...rec,
        label: (l?.label as LabeledFieldRecord['label']) || 'Unknown',
        hardNegative: (l?.hardNegative as LabeledFieldRecord['hardNegative']) || undefined,
        teacherConfidence: l?.confidence ?? 0,
        rationale: l?.rationale,
      });
    });
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI labeling writes to the caller-supplied output path.
  writeFileSync(outPath, labeled.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.error('wrote ' + labeled.length + ' labeled rows -> ' + outPath);
}

main();
