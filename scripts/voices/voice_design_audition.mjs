export const VOICE_DESIGN_MODEL = 'eleven_ttv_v3';

const SAFE_AUDITION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function auditionRelativeDir(prompt) {
  if (!SAFE_AUDITION_ID.test(prompt.npcId) || !SAFE_AUDITION_ID.test(prompt.takeId)) {
    throw new Error(`Unsafe audition id: ${prompt.npcId}:${prompt.takeId}`);
  }
  return [prompt.npcId, prompt.takeId];
}

export function seedForVoiceDesign(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 1) % 2147483647;
}

export function buildVoiceDesignRequest(prompt) {
  auditionRelativeDir(prompt);
  const description = prompt.voiceDescription.trim();
  const text = prompt.previewText.trim();
  if (description.length < 20 || description.length > 1000) {
    throw new Error(`${prompt.npcId} voice description must contain 20 to 1000 characters`);
  }
  if (text.length < 100 || text.length > 1000) {
    throw new Error(`${prompt.npcId} preview text must contain 100 to 1000 characters`);
  }
  const guidanceScale = prompt.guidanceScale ?? 0.45;
  if (!Number.isFinite(guidanceScale) || guidanceScale < 0 || guidanceScale > 1) {
    throw new Error(`${prompt.npcId} guidance scale must be between 0 and 1`);
  }
  return {
    voice_description: description,
    text,
    model_id: VOICE_DESIGN_MODEL,
    seed: seedForVoiceDesign(`${prompt.npcId}:${prompt.takeId}`),
    guidance_scale: guidanceScale,
  };
}

export function normalizeVoiceDesignPreviews(response) {
  if (!Array.isArray(response?.previews) || response.previews.length === 0) {
    throw new Error('Voice Design returned no previews');
  }
  return response.previews.map((preview, index) => {
    if (typeof preview?.generated_voice_id !== 'string' || !preview.generated_voice_id) {
      throw new Error(`Voice Design preview ${index + 1} has no generated voice id`);
    }
    if (typeof preview.audio_base_64 !== 'string' || !preview.audio_base_64) {
      throw new Error(`Voice Design preview ${index + 1} has no audio`);
    }
    return {
      candidate: index + 1,
      generatedVoiceId: preview.generated_voice_id,
      audioBase64: preview.audio_base_64,
    };
  });
}

export function buildVoiceFinalizationRequest(prompt, metadata, candidateNumber) {
  if (!prompt) throw new Error('Voice prompt is unavailable');
  if (metadata?.boss !== prompt.npcId || metadata?.take !== prompt.takeId) {
    throw new Error(`Audition metadata does not match ${prompt.npcId}:${prompt.takeId}`);
  }
  const selected = metadata.candidates?.find(({ candidate }) => candidate === candidateNumber);
  if (!selected?.generatedVoiceId) {
    throw new Error(`Candidate ${candidateNumber} is unavailable`);
  }
  return {
    voice_name: `WoC ${prompt.name}`,
    voice_description: prompt.voiceDescription,
    generated_voice_id: selected.generatedVoiceId,
  };
}

export function voiceIdFromFinalizationResponse(response) {
  if (typeof response?.voice_id !== 'string' || !response.voice_id) {
    throw new Error('Voice finalization returned no voice id');
  }
  return response.voice_id;
}
