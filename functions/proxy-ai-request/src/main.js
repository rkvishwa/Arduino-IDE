const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

function json(res, status, payload) {
  return res.json(payload, status);
}

function ok(res, data, status = 200) {
  return json(res, status, { ok: true, data });
}

function fail(res, status, error, details) {
  return json(res, status, { ok: false, error, details });
}

function parseBody(req) {
  if (req.bodyJson && typeof req.bodyJson === 'object') {
    return req.bodyJson;
  }

  try {
    return JSON.parse(req.bodyText || '{}');
  } catch {
    return {};
  }
}

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function buildProviderConfig(providerName) {
  if (providerName === 'groq') {
    return {
      provider: 'groq',
      endpoint: `${String(process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL).replace(/\/$/, '')}/chat/completions`,
      apiKey: process.env.GROQ_API_KEY || '',
      defaultModel: process.env.GROQ_DEFAULT_MODEL || '',
      extraHeaders: {},
    };
  }

  return {
    provider: 'openrouter',
    endpoint: `${String(process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).replace(/\/$/, '')}/chat/completions`,
    apiKey: process.env.OPENROUTER_API_KEY || '',
    defaultModel: process.env.OPENROUTER_DEFAULT_MODEL || '',
    extraHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://tantalum-ide.local',
      'X-Title': process.env.OPENROUTER_X_TITLE || 'Tantalum IDE',
    },
  };
}

export default async function ({ req, res, error }) {
  try {
    const payload = parseBody(req);
    const provider = payload.provider === 'groq' ? 'groq' : 'openrouter';
    const config = buildProviderConfig(provider);

    if (!config.apiKey) {
      return fail(res, 500, `The ${provider} API key is not configured for this Appwrite function.`);
    }

    const requestBody = {
      ...payload.request,
      model: payload.request?.model || config.defaultModel,
    };

    if (!requestBody.model) {
      return fail(res, 400, 'No model was provided and no default model is configured for the proxy.');
    }

    const upstreamResponse = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...config.extraHeaders,
      },
      body: JSON.stringify(requestBody),
    });

    const rawText = await upstreamResponse.text();
    const parsed = safeParseJson(rawText, { rawText });

    if (!upstreamResponse.ok) {
      return fail(
        res,
        upstreamResponse.status,
        parsed?.error?.message || parsed?.message || `Upstream ${provider} request failed.`,
        parsed,
      );
    }

    return ok(res, parsed);
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Unexpected proxy-ai-request failure.';
    error(message);
    return fail(res, 500, message);
  }
}
