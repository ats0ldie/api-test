import express from 'express';
import { createClient } from '@supabase/supabase-js';

export default function () {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('❌ Credenciales de Supabase no configuradas');
  }

  const router = express.Router();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  router.get('/', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('empleados')
        .select('*');

      if (error) {
        console.error('❌ Supabase error:', error);
        return res.status(500).json({ error: 'Error consultando empleados' });
      }

      res.json(data);
    } catch (err) {
      console.error('⚠️ Error general en empleados:', err);
      res.status(500).json({ error: 'Error inesperado' });
    }
  });

  return router;
}
