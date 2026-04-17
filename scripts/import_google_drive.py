#!/usr/bin/env python3
"""
FSA Lesson Content Import Script

Imports lesson content from a Google Doc (or a local markdown file for testing)
into the fsa_agent database.

Usage:
  # Import from Google Docs:
  python import_google_drive.py \\
    --doc-id "1abc...xyz" \\
    --lesson-code "2A1-1-1" \\
    --chapter-id "2A1-1" \\
    --course-id "2A1" \\
    [--dry-run] [--include-narration]

  # Import from a local markdown file (no Google auth required):
  python import_google_drive.py \\
    --local-file "../docs/source/2A1 Chapter 1 Objective 1.md" \\
    --lesson-code "2A1-1-1" \\
    --chapter-id "2A1-1" \\
    --course-id "2A1" \\
    [--dry-run]

Requirements:
  pip install -r requirements_scripts.txt

Google Cloud setup:
  1. Create a project at console.cloud.google.com
  2. Enable Google Docs API
  3. Create OAuth 2.0 credentials (Desktop app)
  4. Download credentials.json to ../credentials/credentials.json
  On first run, a browser window opens for authorization.
  Token is cached at ../credentials/token.json.
"""

import argparse
import os
import sys
import json

# Add scripts directory to path for local imports
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS_DIR)

# Load .env from project root if running outside Docker
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
env_file = os.path.join(REPO_ROOT, '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, val = line.partition('=')
                os.environ.setdefault(key.strip(), val.strip())

import gdrive_parser
import db_inserter


# -----------------------------------------------------------------------
# Google Docs auth and fetch
# -----------------------------------------------------------------------

CREDENTIALS_PATH = os.path.join(REPO_ROOT, 'credentials', 'credentials.json')
TOKEN_PATH = os.path.join(REPO_ROOT, 'credentials', 'token.json')
SCOPES = ['https://www.googleapis.com/auth/documents.readonly']


def _get_google_creds():
    """Get or refresh Google OAuth2 credentials."""
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
    except ImportError:
        print('ERROR: Google auth libraries not installed.')
        print('Run: pip install -r requirements_scripts.txt')
        sys.exit(1)

    creds = None

    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_PATH):
                print(f'ERROR: credentials.json not found at {CREDENTIALS_PATH}')
                print('Download it from Google Cloud Console → APIs & Services → Credentials')
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save the credentials for the next run
        os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
        with open(TOKEN_PATH, 'w') as token:
            token.write(creds.to_json())

    return creds


def fetch_google_doc(doc_id):
    """
    Fetch a Google Doc via the Docs API and return the body dict.
    """
    try:
        from googleapiclient.discovery import build
    except ImportError:
        print('ERROR: google-api-python-client not installed.')
        print('Run: pip install -r requirements_scripts.txt')
        sys.exit(1)

    creds = _get_google_creds()
    service = build('docs', 'v1', credentials=creds)
    doc = service.documents().get(documentId=doc_id).execute()
    return doc.get('body', {})


# -----------------------------------------------------------------------
# Local file import (for testing without Google auth)
# -----------------------------------------------------------------------

def read_local_file(path):
    """Read a local markdown/text file."""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


# -----------------------------------------------------------------------
# Main import logic
# -----------------------------------------------------------------------

def run_import(args):
    lesson_code = args.lesson_code
    chapter_id = args.chapter_id
    course_id = args.course_id
    dry_run = args.dry_run
    include_narration = args.include_narration

    print(f'{"[DRY RUN] " if dry_run else ""}Importing lesson {lesson_code}...')

    # --- Fetch document ---
    if args.local_file:
        print(f'Reading local file: {args.local_file}')
        raw_text = read_local_file(args.local_file)
        parsed = gdrive_parser.parse_text(raw_text)
    elif args.doc_id:
        print(f'Fetching Google Doc: {args.doc_id}')
        doc_body = fetch_google_doc(args.doc_id)
        parsed = gdrive_parser.parse_google_doc(doc_body)
    else:
        print('ERROR: Either --doc-id or --local-file is required')
        sys.exit(1)

    lesson_title = parsed['title']
    key_points = parsed['key_points']
    worked_problems = parsed['worked_problems']

    print(f'Parsed: title={lesson_title!r}')
    print(f'  {len(key_points)} key point section(s)')
    print(f'  {len(worked_problems)} worked problem(s)')

    if dry_run:
        print('\n--- Key Points ---')
        for kp in key_points:
            print(f'  [{kp["title"]}]')
            print(f'  {kp["content"][:120]}...')
            print()

        print('--- Worked Problems ---')
        for wp in worked_problems:
            print(f'  Problem: {wp["problem_title"]!r}')
            print(f'  Question text: {wp["question_text"][:120]!r}')
            steps = wp['step_data'].get('steps', [])
            for step in steps:
                print(f'    Step {step["step"]} [{step["type"]}]: {step["title"]}')
            print()
        print('[DRY RUN] No changes written to DB.')
        return

    # --- Write to DB ---
    narration = None
    if include_narration:
        # Build narration from all section content joined together
        narration = '\n\n'.join(
            f'{kp["title"]}\n\n{kp["content"]}' for kp in key_points
        )

    # Count before
    before_count = db_inserter.get_question_count(lesson_code)

    # Upsert lesson
    lesson_id = db_inserter.upsert_lesson(lesson_code, lesson_title, key_points, narration)
    print(f'Upserted lesson: id={lesson_id}, lesson_code={lesson_code!r}')

    # Insert worked problems
    inserted = 0
    for wp in worked_problems:
        qid = db_inserter.insert_worked_problem(lesson_code, chapter_id, course_id, wp)
        if qid:
            inserted += 1
            print(f'  Inserted question id={qid}: {wp["problem_title"]!r}')

    after_count = db_inserter.get_question_count(lesson_code)
    print(f'\nDone. Questions for {lesson_code}: {before_count} → {after_count} (+{after_count - before_count})')


# -----------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='Import FSA lesson content from Google Docs or a local file into PostgreSQL.'
    )

    source = parser.add_mutually_exclusive_group()
    source.add_argument('--doc-id', help='Google Doc ID (from URL)')
    source.add_argument('--local-file', help='Path to local markdown file (for testing)')

    parser.add_argument('--lesson-code', required=True,
                        help='Lesson code, e.g. 2A1-1-1')
    parser.add_argument('--chapter-id', required=True,
                        help='Chapter ID, e.g. 2A1-1')
    parser.add_argument('--course-id', required=True,
                        help='Course ID, e.g. 2A1')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print what would be written without touching the DB')
    parser.add_argument('--include-narration', action='store_true',
                        help='Write all section content to lessons.narration_text '
                             '(normally handled by n8n workflow)')

    args = parser.parse_args()

    if not args.doc_id and not args.local_file:
        parser.error('Either --doc-id or --local-file is required')

    run_import(args)


if __name__ == '__main__':
    main()
