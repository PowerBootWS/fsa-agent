import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime

load_dotenv("../../.env")

app = Flask(__name__)
CORS(app)

# Import agents
from agents.orchestrator import Orchestrator
from agents.tutor import TutorAgent
from agents.researcher import Researcher
from agents.display import DisplayAgent
from agents.checkpoint import generate_checkin
from agents.resume_writer import generate_tailored_documents

# Initialize agents
orchestrator = Orchestrator()
tutor = TutorAgent()
researcher = Researcher()
display = DisplayAgent()


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/agent/chat', methods=['POST'])
def chat():
    """Main chat endpoint - interacts with Tutor Agent"""
    data = request.json
    user = data.get('user')
    lesson_id = data.get('lessonId')
    message = data.get('message')
    exam_config = data.get('examConfig')  # optional: {count: int, timed: bool}

    if not all([user, lesson_id, message]):
        return jsonify({'error': 'Missing required parameters'}), 400

    # Get lesson context from Researcher
    lesson_context = researcher.get_lesson_context(lesson_id)

    # Get user progress for context
    progress = researcher.get_user_progress(user, lesson_id)

    # Process through Orchestrator
    kwargs = dict(
        user=user,
        lesson_id=lesson_id,
        message=message,
        lesson_context=lesson_context,
        progress=progress,
        tutor=tutor,
        display=display,
        researcher=researcher,
    )
    if exam_config is not None:
        kwargs['exam_config'] = exam_config
    response = orchestrator.process(**kwargs)

    return jsonify(response)


@app.route('/agent/context/<lesson_id>', methods=['GET'])
def get_context(lesson_id):
    """Get lesson context for debugging"""
    context = researcher.get_lesson_context(lesson_id)
    return jsonify(context)


@app.route('/agent/exam/<course_id>/last-results', methods=['GET'])
def get_last_results(course_id):
    """
    Return cached debrief data for the most recent completed exam for this user+course.
    Used by the lobby to offer a "Review most recent results" button.
    Returns {available: false} when no cached results exist (first attempt or service restart).
    """
    user = request.args.get('user')
    if not user:
        return jsonify({'error': 'Missing user'}), 400
    state_key = f'{user}:{course_id}'
    state = orchestrator.conversation_state.get(state_key, {})
    last_debrief = state.get('last_debrief')
    # Fall back to the durable DB copy when the in-memory session is gone
    # (first load on a new device, or after an AI-service restart/deploy).
    if not last_debrief:
        last_debrief = researcher.get_last_debrief(user, course_id)
    if not last_debrief:
        return jsonify({'available': False})
    return jsonify({'available': True, **last_debrief})


@app.route('/agent/demo/exam-debrief', methods=['POST'])
def demo_seed_exam():
    """
    Seed in-memory orchestrator state for demo purposes.
    Pre-populates a completed exam session so the next chat message
    triggers the debrief immediately — no need to answer 50 questions.

    Body: { "user": "demo@...", "lessonId": "2A1" }
    """
    data = request.json or {}
    user = data.get('user')
    lesson_id = data.get('lessonId')
    if not user or not lesson_id:
        return jsonify({'error': 'Missing user or lessonId'}), 400
    result = orchestrator.seed_demo_exam(user, lesson_id, researcher)
    return jsonify(result)


@app.route('/checkpoint', methods=['POST'])
def checkpoint():
    """Generate an adaptive check-in message for a lesson pause."""
    data = request.json or {}
    sections_covered = data.get('sections_covered', [])
    correct_pct = float(data.get('correct_pct', 0.0))
    question_count = int(data.get('question_count', 0))

    if not sections_covered:
        return jsonify({'error': 'sections_covered required'}), 400

    message = generate_checkin(sections_covered, correct_pct, question_count)
    return jsonify({'message': message})


GENERATED_DOCS_DIR = os.getenv('GENERATED_DOCS_DIR', '/srv/fsa-generated-documents')


@app.route('/agent/resume-tailor', methods=['POST'])
def resume_tailor():
    """
    Tailor a resume and/or cover letter to a specific saved job.
    Body: {
      job: {title, company, description_snapshot},
      user_id: int, saved_job_id: int,
      resume: {path, mime_type},
      cover_letter: {path, mime_type} | null,
      doc_types: ["resume"] | ["cover_letter"] | ["resume", "cover_letter"]
    }
    """
    data = request.json or {}
    job = data.get('job')
    user_id = data.get('user_id')
    saved_job_id = data.get('saved_job_id')
    resume = data.get('resume')
    cover_letter = data.get('cover_letter')
    doc_types = data.get('doc_types')

    if not job or not user_id or not saved_job_id or not resume or not doc_types:
        return jsonify({'error': 'Missing required parameters'}), 400

    output_dir = os.path.join(
        GENERATED_DOCS_DIR, str(user_id), str(saved_job_id),
        datetime.utcnow().strftime('%Y%m%dT%H%M%S%f')
    )

    try:
        result = generate_tailored_documents(
            job=job,
            resume_path=resume['path'],
            resume_mime=resume['mime_type'],
            cover_letter_path=cover_letter['path'] if cover_letter else None,
            cover_letter_mime=cover_letter['mime_type'] if cover_letter else None,
            doc_types=doc_types,
            output_dir=output_dir,
        )
    except ValueError as err:
        if str(err) == 'NO_EXTRACTABLE_TEXT':
            return jsonify({'error': 'UNREADABLE_SOURCE_DOCUMENT'}), 422
        return jsonify({'error': str(err)}), 502

    return jsonify(result)


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)