import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app)

# Import agents
from agents.orchestrator import Orchestrator
from agents.tutor import TutorAgent
from agents.researcher import Researcher
from agents.display import DisplayAgent

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

    if not all([user, lesson_id, message]):
        return jsonify({'error': 'Missing required parameters'}), 400

    # Get lesson context from Researcher
    lesson_context = researcher.get_lesson_context(lesson_id)

    # Get user progress for context
    progress = researcher.get_user_progress(user, lesson_id)

    # Process through Orchestrator
    response = orchestrator.process(
        user=user,
        lesson_id=lesson_id,
        message=message,
        lesson_context=lesson_context,
        progress=progress,
        tutor=tutor,
        display=display
    )

    return jsonify(response)


@app.route('/agent/context/<lesson_id>', methods=['GET'])
def get_context(lesson_id):
    """Get lesson context for debugging"""
    context = researcher.get_lesson_context(lesson_id)
    return jsonify(context)


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)