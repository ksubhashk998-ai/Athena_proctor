import cv2
import numpy as np
import base64
from deepface import DeepFace
from deepface.basemodels import ArcFace
import tempfile
import os
from datetime import datetime

class FaceProcessor:
    def __init__(self):
        self.similarity_threshold = 0.6
        
    def decode_image(self, base64_image):
        """Convert base64 to OpenCV image"""
        try:
            # Remove data URL prefix if present
            if ',' in base64_image:
                base64_image = base64_image.split(',')[1]
            image_data = base64.b64decode(base64_image)
            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        except Exception as e:
            print(f"Decode error: {e}")
            return None
    
    def detect_faces(self, image):
        """Detect faces in image"""
        try:
            faces = DeepFace.extract_faces(
                img_path=image,
                detector_backend='opencv',
                enforce_detection=False
            )
            return faces
        except Exception as e:
            print(f"Face detection error: {e}")
            return []
    
    def get_face_embedding(self, image):
        """Generate ArcFace embedding"""
        try:
            # Save image temporarily
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                cv2.imwrite(tmp.name, image)
                tmp_path = tmp.name
            
            # Generate embedding using DeepFace
            embedding = DeepFace.represent(
                img_path=tmp_path,
                model_name='ArcFace',
                detector_backend='opencv',
                enforce_detection=True
            )
            
            # Clean up
            os.unlink(tmp_path)
            
            if embedding:
                return embedding[0]['embedding'], "Success"
            return None, "No face detected"
            
        except Exception as e:
            return None, str(e)
    
    def verify_face(self, embedding1, embedding2):
        """Compare two face embeddings using cosine similarity"""
        try:
            emb1 = np.array(embedding1)
            emb2 = np.array(embedding2)
            
            # Cosine similarity
            similarity = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))
            is_match = similarity >= self.similarity_threshold
            
            return {
                'verified': is_match,
                'similarity': float(similarity),
                'threshold': self.similarity_threshold
            }
        except Exception as e:
            return {
                'verified': False,
                'similarity': 0,
                'threshold': self.similarity_threshold,
                'error': str(e)
            }
    
    def liveness_detection(self, image):
        """Basic liveness detection to prevent photo attacks"""
        try:
            # Check for face landmarks
            faces = DeepFace.extract_faces(
                img_path=image,
                detector_backend='opencv',
                enforce_detection=True
            )
            
            if len(faces) == 0:
                return False, "No face detected"
            
            # Texture analysis (detect printed photos/screens)
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
            
            if laplacian_var < 50:
                return False, "Potential printed photo or screen detected"
            
            return True, "Liveness verified"
            
        except Exception as e:
            return False, f"Liveness check failed: {str(e)}"