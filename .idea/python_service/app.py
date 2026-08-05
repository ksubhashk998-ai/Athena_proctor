from flask import Flask, request, jsonify
from flask_cors import CORS
from face_processor import FaceProcessor
import numpy as np

app = Flask(__name__)
CORS(app)

# Initialize face processor
face_processor = FaceProcessor()

@app.route('/api/face/register', methods=['POST'])
def register_face():
    """Register a user's face"""
    try:
        data = request.json
        user_id = data.get('userId')
        face_images = data.get('faceImages', [])
        
        if not user_id or not face_images:
            return jsonify({'error': 'Missing required fields'}), 400
        
        embeddings = []
        successful_captures = 0
        
        # Process up to 5 images
        for img_data in face_images[:5]:
            image = face_processor.decode_image(img_data)
            if image is None:
                continue
            
            # Check for single face
            faces = face_processor.detect_faces(image)
            if len(faces) == 1:
                embedding, status = face_processor.get_face_embedding(image)
                if embedding is not None:
                    embeddings.append(embedding)
                    successful_captures += 1
        
        if successful_captures < 3:
            return jsonify({
                'error': f'Need at least 3 valid face captures. Got {successful_captures}'
            }), 400
        
        # Average the embeddings for better accuracy
        avg_embedding = np.mean(embeddings, axis=0).tolist()
        
        return jsonify({
            'success': True,
            'message': f'Face registered with {successful_captures} captures',
            'embedding': avg_embedding
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/face/verify', methods=['POST'])
def verify_face():
    """Verify a user's face"""
    try:
        data = request.json
        face_image = data.get('faceImage')
        stored_embedding = data.get('storedEmbedding')
        
        if not face_image or not stored_embedding:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Decode and process image
        image = face_processor.decode_image(face_image)
        if image is None:
            return jsonify({'error': 'Invalid image'}), 400
        
        # Liveness detection
        is_live, message = face_processor.liveness_detection(image)
        if not is_live:
            return jsonify({
                'verified': False,
                'error': 'Liveness check failed',
                'details': message
            }), 400
        
        # Check for single face
        faces = face_processor.detect_faces(image)
        if len(faces) == 0:
            return jsonify({
                'verified': False,
                'error': 'No face detected'
            }), 400
        if len(faces) > 1:
            return jsonify({
                'verified': False,
                'error': 'Multiple faces detected'
            }), 400
        
        # Get current face embedding
        live_embedding, status = face_processor.get_face_embedding(image)
        if live_embedding is None:
            return jsonify({
                'verified': False,
                'error': status
            }), 400
        
        # Verify against stored embedding
        result = face_processor.verify_face(stored_embedding, live_embedding)
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/face/detect', methods=['POST'])
def detect_face():
    """Detect face presence"""
    try:
        data = request.json
        face_image = data.get('faceImage')
        
        if not face_image:
            return jsonify({'error': 'Missing image'}), 400
        
        image = face_processor.decode_image(face_image)
        if image is None:
            return jsonify({'error': 'Invalid image'}), 400
        
        faces = face_processor.detect_faces(image)
        face_count = len(faces)
        
        if face_count == 0:
            return jsonify({
                'face_count': 0,
                'status': 'NO_FACE'
            }), 200
        elif face_count == 1:
            return jsonify({
                'face_count': 1,
                'status': 'OK'
            }), 200
        else:
            return jsonify({
                'face_count': face_count,
                'status': 'MULTIPLE_FACES'
            }), 200
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)