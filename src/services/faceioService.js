'use strict';
const axios = require('axios');

/**
 * Servicio para integrar con FaceIO API
 * Documentación: https://face.io/docs/
 */
class FaceIOService {
  constructor() {
    this.apiKey = process.env.FACEIO_API_KEY;
    this.baseUrl = 'https://api.face.io';

    if (!this.apiKey) {
      console.warn('FACEIO_API_KEY no está configurada en las variables de entorno');
    }
  }

  /**
   * Inscribir un rostro en FaceIO
   * @param {string} imageUrl - URL pública de la imagen del rostro
   * @param {object} options - Opciones adicionales
   * @returns {Promise<Object>} Respuesta de FaceIO con faceId
   */
  async enrollFace(imageUrl, options = {}) {
    if (!this.apiKey) {
      throw new Error('FACEIO_API_KEY no configurada');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/enroll`,
        {
          img: imageUrl,
          ...options
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error al inscribir rostro en FaceIO:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Autenticar/identificar un rostro contra los inscritos
   * @param {string} imageUrl - URL pública de la imagen a verificar
   * @param {object} options - Opciones adicionales
   * @returns {Promise<Object>} Respuesta de FaceIO con resultado de autenticación
   */
  async authenticateFace(imageUrl, options = {}) {
    if (!this.apiKey) {
      throw new Error('FACEIO_API_KEY no configurada');
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/auth`,
        {
          img: imageUrl,
          ...options
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error al autenticar rostro en FaceIO:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Obtener información de un faceId específico
   * @param {string} faceId - ID facial a consultar
   * @returns {Promise<Object>} Información del rostro inscrito
   */
  async getFaceInfo(faceId) {
    if (!this.apiKey) {
      throw new Error('FACEIO_API_KEY no configurada');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/face/${faceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error al obtener información de faceId:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Eliminar un faceId específico
   * @param {string} faceId - ID facial a eliminar
   * @returns {Promise<Object>} Respuesta de eliminación
   */
  async deleteFace(faceId) {
    if (!this.apiKey) {
      throw new Error('FACEIO_API_KEY no configurada');
    }

    try {
      const response = await axios.delete(
        `${this.baseUrl}/face/${faceId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error al eliminar faceId:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new FaceIOService();