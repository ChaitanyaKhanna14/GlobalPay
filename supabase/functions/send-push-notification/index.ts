/**
 * Supabase Edge Function: Send Push Notification
 * Sends push notifications via Expo Push API
 *
 * Payload:
 * {
 *   user_id: string;
 *   title: string;
 *   body: string;
 *   data?: Record<string, unknown>;
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushPayload {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  data?: Record<string, unknown>;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  badge?: number;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error: string };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Parse request body
    const payload: PushPayload = await req.json();

    // Validate required fields
    if (!payload.user_id || !payload.title || !payload.body) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: user_id, title, body' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query push_tokens table for the user's tokens
    const { data: tokens, error: queryError } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('user_id', payload.user_id);

    if (queryError) {
      console.error('Error querying push_tokens:', queryError);
      return new Response(
        JSON.stringify({ error: 'Failed to query push tokens' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No push tokens found for user',
          sent: 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Build Expo push messages
    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      sound: 'default',
      data: payload.data ?? {},
      priority: 'high',
      channelId: t.platform === 'android' ? 'payments' : undefined,
    }));

    // Send to Expo Push API
    const pushResponse = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!pushResponse.ok) {
      const errorText = await pushResponse.text();
      console.error('Expo Push API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to send push notification', details: errorText }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const pushResult = await pushResponse.json();
    const tickets: ExpoPushTicket[] = pushResult.data ?? [];

    // Check for invalid tokens and clean them up
    const invalidTokenIndices: number[] = [];
    tickets.forEach((ticket, index) => {
      if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        invalidTokenIndices.push(index);
      }
    });

    // Remove invalid tokens from database
    if (invalidTokenIndices.length > 0) {
      const invalidTokens = invalidTokenIndices.map((i) => tokens[i].token);
      await supabase
        .from('push_tokens')
        .delete()
        .in('token', invalidTokens);
      console.log(`Cleaned up ${invalidTokens.length} invalid tokens`);
    }

    const successCount = tickets.filter((t) => t.status === 'ok').length;

    return new Response(
      JSON.stringify({
        success: true,
        sent: successCount,
        total: tokens.length,
        tickets,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (e) {
    console.error('Unexpected error:', e);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(e) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
