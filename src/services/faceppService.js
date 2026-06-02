'use strict';

const axios = require('axios');

const PLACEHOLDER_VALUES = new Set(['', 'TU_API_KEY', 'TU_API_SECRET']);

class FacePPService {
  constructor() {
    this.apiKey = process.env.FACEPP_API_KEY;
    this.apiSecret = process.env.FACEPP_API_SECRET;
    this.baseUrl = process.env.FACEPP_BASE_URL || 'https://api-us.faceplusplus.com/facepp/v3';
    this.confidenceThreshold = Number(process.env.FACEPP_CONFIDENCE_THRESHOLD) || 75;

    if (!this.isConfigured) {
      console.warn('[Face++] FACEPP_API_KEY/FACEPP_API_SECRET no configuradas; biometría server-side deshabilitada.');
    }
  }

  get isConfigured() {
    return !PLACEHOLDER_VALUES.has(this.apiKey || '') && !PLACEHOLDER_VALUES.has(this.apiSecret || '');
  }

  _checkCredentials() {
    if (!this.isConfigured) {
      throw new Error('FACEPP_API_KEY y FACEPP_API_SECRET deben estar configuradas en variables de entorno.');
    }
  }

  async _post(endpoint, params) {
    this._checkCredentials();

    const body = new URLSearchParams({
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      ...params,
    });

    try {
      const { data } = await axios.post(`${this.baseUrl}${endpoint}`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      return data;
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.error_message || data?.message || err.message;
      throw new Error(`[Face++] ${endpoint} falló: ${msg}`);
    }
  }

  _normalizeDetectResult(data) {
    const faces = Array.isArray(data?.faces) ? data.faces : [];
    if (!faces.length) {
      throw new Error('Face++ no detectó ningún rostro en la imagen.');
    }

    const face = faces[0];
    return {
      faceToken: face.face_token,
      faceId: face.face_token,
      faceRectangle: face.face_rectangle,
      faceCount: faces.length,
      raw: data,
    };
  }

  async detectFromImageUrl(imageUrl) {
    const data = await this._post('/detect', {
      image_url: imageUrl,
      return_attributes: 'none',
    });
    return this._normalizeDetectResult(data);
  }

  async detectFromImageBase64(imageBase64) {
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    const data = await this._post('/detect', {
      image_base64: cleanBase64,
      return_attributes: 'none',
    });
    return this._normalizeDetectResult(data);
  }

  async compareFaceTokens(faceToken1, faceToken2) {
    return this.compareFaces({ faceToken: faceToken1 }, { faceToken: faceToken2 });
  }

  async compareFaces(face1, face2) {
    const data = await this._post('/compare', {
      ...this._faceParams(face1, '1'),
      ...this._faceParams(face2, '2'),
    });

    const confidence = Number(data.confidence || 0);
    const thresholds = data.thresholds || {};
    const threshold = Number(process.env.FACEPP_CONFIDENCE_THRESHOLD) || Number(thresholds['1e-5']) || this.confidenceThreshold;

    return {
      matched: confidence >= threshold,
      confidence,
      threshold,
      thresholds,
      raw: data,
    };
  }

  _faceParams(face, suffix) {
    if (face.faceToken) return { [`face_token${suffix}`]: face.faceToken };
    if (face.imageUrl) return { [`image_url${suffix}`]: face.imageUrl };
    if (face.imageBase64) {
      return {
        [`image_base64_${suffix}`]: face.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, ''),
      };
    }
    throw new Error(`Faltan datos de rostro para comparación ${suffix}.`);
  }

  async detectProbe({ imageUrl, imageBase64, faceToken }) {
    if (faceToken) return { faceToken, faceId: faceToken, faceCount: 1, raw: null };
    if (imageBase64) return this.detectFromImageBase64(imageBase64);
    if (imageUrl) return this.detectFromImageUrl(imageUrl);
    throw new Error('Debe enviar faceToken, imageUrl o imageBase64.');
  }

  async findBestMatch(probeFace, candidates, getCandidateFace) {
    let best = null;

    for (const candidate of candidates) {
      const comparison = await this.compareFaces(probeFace, getCandidateFace(candidate));
      if (!best || comparison.confidence > best.comparison.confidence) {
        best = { candidate, comparison };
      }
    }

    return best;
  }

  async enrollFace(imageUrl) {
    return this.detectFromImageUrl(imageUrl);
  }

  async deleteFace() {
    return { skipped: true, reason: 'Face++ face_token no requiere eliminación si no se usa FaceSet.' };
  }
}

module.exports = new FacePPService();
