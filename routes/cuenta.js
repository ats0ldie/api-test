import express from 'express';

export default function (pool) {
    const router = express.Router();

    // Helper functions
    async function traevalor(pool, clave, descripcion, grupo = '') {
        const query = grupo ?
            `SELECT valor FROM valores WHERE clave = ? AND grupo = ?` :
            `SELECT valor FROM valores WHERE clave = ?`;
        const params = grupo ? [clave, grupo] : [clave];
        try {
            const [rows] = await pool.promise().query(query, params);
            return rows.length > 0 ? rows[0].valor : '';
        } catch (err) {
            console.error('Error in traevalor:', err);
            return '';
        }
    }

    async function damereg(pool, sql) {
        try {
            const [rows] = await pool.promise().query(sql);
            return rows.length > 0 ? rows[0] : null;
        } catch (err) {
            console.error('Error in damereg:', err);
            return null;
        }
    }

    async function dameval(pool, sql) {
        try {
            const [rows] = await pool.promise().query(sql);
            return rows.length > 0 ? rows[0][Object.keys(rows[0])[0]] : null;
        } catch (err) {
            console.error('Error in dameval:', err);
            return null;
        }
    }

    async function tasafecha(pool, fecha) {
        // Assuming there's a table 'tasas' with fecha and tasa
        const query = `SELECT tasa FROM tasas WHERE fecha <= ? ORDER BY fecha DESC LIMIT 1`;
        try {
            const [rows] = await pool.promise().query(query, [fecha]);
            return rows.length > 0 ? rows[0].tasa : 1; // Default to 1 if no rate
        } catch (err) {
            console.error('Error in tasafecha:', err);
            return 1;
        }
    }

    // Calcula pronto pago segun esquema de descuentos
    async function calppago(pool, id, fbanco, origen = 'F', descua = 0) {
        const activo = await traevalor(pool, 'SMOVPPAGO', '(S/N) Activar Descuento Por Pronto Pago Automatico');
        if (activo !== 'S') return 0.00;

        let ppago = 0;
        const forcal = await traevalor(pool, 'GCLIPPAGO', 'Calcula sobre la (B)ase o sobre el (T)otal por defecto TOTAL', 'GECLI') || 'T';
        let mcampo = '';

        if (id === 0) return 0.00;

        const mSQL = `SELECT cod_cli, tipo_doc, tipo_ref, numero FROM smov WHERE id = ${id}`;
        const tipos = await damereg(pool, mSQL);
        if (!tipos) return 0.00;

        let sfac;
        if (tipos.tipo_doc === 'FC') {
            mcampo = forcal === 'T' ? 'b.totalg' : 'b.totals';
            const mcampo2 = forcal === 'T' ? 'ROUND(a.monto - a.abonos, 2)' : 'ROUND(a.monto - a.impuesto)';
            const query = `
                SELECT ${mcampo} totalg, c.auxiliar tipodesc, c.porppago1 descuento, 
                       c.cliente, b.fecha ffact, b.totalgd, ${mcampo2} saldo,
                       DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) dias,
                       0 AS diasc, 
                       IF(b.entregado IS NULL, b.fecha, b.entregado) entrega,
                       b.id idrel
                FROM sfac b
                JOIN smov a ON a.transac = b.transac
                JOIN scli c ON b.cod_cli = c.cliente
                WHERE a.id = ${id}
            `;
            sfac = await damereg(pool, query);
        } else {
            mcampo = 'b.stotal';
            const mcampo2 = 'ROUND(a.monto - a.abonos, 2)';
            const query = `
                SELECT b.cod_cli, ${mcampo} totalg, c.auxiliar tipodesc, 
                       COALESCE(c.porppago1, 0) descuento,
                       c.cliente, b.fecha ffact, b.stotald totalgd, ${mcampo2} saldo,
                       DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) dias,
                       0 AS diasc, 
                       IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado) entrega, 
                       b.id idrel
                FROM snte b
                JOIN smov a ON a.transac = b.transac
                JOIN scli c ON b.cod_cli = c.cliente
                WHERE a.id = ${id}
            `;
            sfac = await damereg(pool, query);
        }
        if (!sfac) return 0.00;

        let cond;
        if (tipos.tipo_doc === 'FC') {
            cond = await dameval(pool, `SELECT referen FROM pfac WHERE factura = '${tipos.numero}'`);
        } else {
            const query = `
                SELECT b.referen 
                FROM snte a
                JOIN pfac b ON a.orden = b.numero 
                WHERE a.cod_cli = b.cod_cli AND a.numero = '${tipos.numero}'
            `;
            cond = await dameval(pool, query);
        }

        const sindesc = await dameval(pool, `SELECT sindescu FROM sfac WHERE numero = '${tipos.numero}' AND tipo_doc = 'F'`);

        if (cond === 'X' || sindesc === 'M') return 0.00;

        const cliente = sfac.cliente;
        const tipodesc = 'P'; // Assuming
        const descu = sfac.descuento;
        let porcen = 0;
        const idrel = sfac.idrel;

        if (tipodesc === 'N') return 0.00;

        const devoQuery = `
            SELECT SUM(b.totalg) devo
            FROM itccli a
            JOIN sfac b ON a.numccli = b.numero AND a.tipoccli = 'NC' AND b.tipo_doc = 'D'
            WHERE a.tipo_doc = 'FC' AND a.tipoccli = 'NC' AND a.numero = '${tipos.numero}'
        `;
        const devo = await dameval(pool, devoQuery) || 0;

        const abonos = await dameval(pool, `SELECT abonos FROM smov WHERE numero = '${tipos.numero}' AND tipo_doc = 'FC'`) || 0;

        let porcenQuery;
        if (tipos.tipo_doc === 'FC') {
            porcenQuery = `
                SELECT GREATEST(
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago1) * porppago1,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago2) * porppago2,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago3) * porppago3,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago4) * porppago4
                ) porppago
                FROM scli a
                LEFT JOIN sfac b ON a.cliente = b.cod_cli
                WHERE cliente = '${cliente}' AND b.id = ${idrel}
            `;
        } else {
            porcenQuery = `
                SELECT GREATEST(
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago1) * porppago1,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago2) * porppago2,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago3) * porppago3,
                    (DATEDIFF('${fbanco}', IF(b.entregado IS NULL OR b.entregado = 0, b.fecha, b.entregado)) <= diasppago4) * porppago4
                ) porppago
                FROM scli a
                LEFT JOIN snte b ON a.cliente = b.cod_cli
                WHERE cliente = '${cliente}' AND b.id = ${idrel}
            `;
        }
        porcen = parseFloat(await dameval(pool, porcenQuery)) || 0;

        let tppago = (sfac.totalg - devo) * porcen / 100;
        if (descua > 0) {
            const tppago1 = (sfac.totalg - devo) * porcen / 100;
            const tppago2 = sfac.saldo * descua / 100;
            tppago = tppago1 + tppago2;
        }
        if (tppago < 0) tppago = 0;
        return Math.round(tppago * 100) / 100;
    }

    // Calcula diferencia en cambio
    async function caldifc(pool, id, fbanco, ppago = 0, tasa = 0) {
        if (id === 0) return 0.00;

        const mSQL = `SELECT cod_cli, tipo_doc, tipo_ref, numero FROM smov WHERE id = ${id}`;
        const tipos = await damereg(pool, mSQL);
        if (!tipos) return 0.00;

        let query;
        if (tipos.tipo_doc === 'FC') {
            query = `
                SELECT a.numero, a.fecha, a.monto, a.abonos, 
                       IF(c.mfactura > 0, c.mfactura, COALESCE(b.mfactura, 0)) mfactura,
                       IF(c.mfactura > 0, IF(c.mfactura = 1, 0, c.mfactura), COALESCE(b.mfactura, 0)) < DATEDIFF('${fbanco}', IF(c.entregado IS NULL OR c.entregado = 0, a.fecha, c.entregado)) aplica,
                       IF(b.tiva = 'E', ROUND(a.impuesto * 0.75, 2), 0) reiva,
                       a.montod, c.totalgd,
                       ROUND(a.abonos / IF(a.dolarcambio > 0, a.dolarcambio, a.monto / a.montod), 2) abonosd,
                       ROUND(IF(b.tiva = 'E', ROUND(a.impuesto * 0.75, 2), 0) / a.dolarcambio, 2) reivad 
                FROM smov a
                JOIN scli b ON a.cod_cli = b.cliente
                JOIN sfac c ON a.tipo_doc = 'FC' AND c.tipo_doc = 'F' AND a.numero = c.numero
                WHERE a.id = ${id}
            `;
        } else {
            query = `
                SELECT a.numero, a.fecha, a.monto, a.abonos, 
                       IF(c.mfactura > 0, c.mfactura, COALESCE(b.mfactura, 0)) mfactura,
                       IF(c.mfactura > 0, IF(c.mfactura = 1, 0, c.mfactura), COALESCE(b.mfactura, 0)) < DATEDIFF('${fbanco}', IF(c.entregado IS NULL OR c.entregado = 0, a.fecha, c.entregado)) aplica,
                       IF(b.tiva = 'E', ROUND(a.impuesto * 0.75, 2), 0) reiva,
                       a.montod, c.gtotald totalgd,
                       ROUND(a.abonos / IF(a.dolarcambio > 0, a.dolarcambio, a.monto / a.montod), 2) abonosd, 
                       ROUND(IF(b.tiva = 'E', ROUND(a.impuesto * 0.75, 2), 0) / a.dolarcambio, 2) reivad
                FROM smov a
                JOIN scli b ON a.cod_cli = b.cliente
                JOIN snte c ON a.tipo_doc = 'ND' AND c.tipo_doc = a.tipo_ref AND c.numero = a.num_ref
                WHERE a.id = ${id}
            `;
        }

        const smov = await damereg(pool, query);
        if (!smov) return 0.00;

        if (smov.aplica === 0) return 0.00;

        if (smov.reiva === smov.monto - smov.abonos) return 0.00;

        let hoydolar = await tasafecha(pool, fbanco);
        if (tasa > 0) hoydolar = tasa;
        const emidolar = await tasafecha(pool, smov.fecha);

        const exrete = await dameval(pool, `SELECT COUNT(*) FROM itrivc WHERE numero = '${smov.numero}'`);

        let saldo;
        if (exrete === 0) {
            saldo = smov.monto - smov.abonos - smov.reiva - ppago;
        } else {
            saldo = smov.monto - smov.abonos - ppago;
        }

        let difc;
        if (tasa > 0) {
            const montod = smov.totalgd;
            const saldod = montod - smov.abonosd - smov.reivad - Math.round(ppago / emidolar * 100) / 100;
            difc = Math.round(saldod * tasa * 100) / 100 - saldo;
        } else {
            difc = Math.round(saldo * hoydolar / emidolar * 100) / 100 - saldo;
        }

        if (difc < 0) difc = 0;
        return Math.round(difc * 100) / 100;
    }

    // Calcula ela diferencia de recargo por pronto pago no cumplido
    async function difpp(pool, id, fbanco, tasa = 0) {
        if (id === 0) return 0.00;

        const query = `
            SELECT a.monto, a.fecha, DATEDIFF(CURDATE(), a.vence) AS dv
            FROM smov a
            WHERE a.id = ${id} AND a.tipo_doc = 'FC'
        `;
        const smov = await damereg(pool, query);
        if (!smov) return 0.00;

        const monto = smov.monto;

        let hoydolar = await tasafecha(pool, fbanco);
        if (tasa > 0) hoydolar = tasa;
        const emidolar = await tasafecha(pool, smov.fecha);
        const montobshoy = Math.round(monto * hoydolar / emidolar * 100) / 100;

        let difpp = 0;
        if (smov.fecha >= '2025-12-01' && smov.dv > 0) {
            difpp = montobshoy * 0.10;
        }

        return Math.round(difpp * 100) / 100;
    }

    // Calcula si cobra sin retencion
    async function calrete(pool, id) {
        if (id === 0) return 0.00;

        const query = `
            SELECT a.tipo_doc, a.numero, a.impuesto, b.tiva
            FROM smov a
            JOIN scli b ON a.cod_cli = b.cliente
            WHERE a.id = ${id}
        `;
        const smov = await damereg(pool, query);
        if (!smov) return 0.00;

        if (smov.tiva !== 'E') return 0.00;

        let tipodoc = 'F';
        if (smov.tipo_doc === 'ND') tipodoc = smov.tipo_doc;

        const hay = await dameval(pool, `SELECT COUNT(*) FROM itrivc WHERE tipo_doc = '${tipodoc}' AND numero = '${smov.numero}'`);
        if (hay > 0) return 0.00;

        const rete = Math.round(smov.impuesto * 0.75 * 100) / 100;
        return rete;
    }

    // 📄 Obtener datos de un cliente por email
    router.get('/by-email/:email', async (req, res) => {
        const { email } = req.params;

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Formato de email inválido' });
        }

        const query = `
       SELECT 
        a.cod_cli, a.tipo_doc, a.fecha, a.transac, a.impuesto, a.num_ref, a.vence, a.numero, 
        concat(IF(a.tipo_doc = 'ND' AND a.tipo_ref = 'NE' AND a.num_ref <> '', a.num_ref, a.numero ), a.tipo_doc) AS numeroc,
        IF(d.factura IS NULL, 'N', IF(e.operacion = 'C','C','S')) AS recla,
        a.abonos, b.cliente, b.nombre, b.rifci, a.id, 
        DATEDIFF(CURDATE(), a.vence) AS dv, 
        a.monto * IF(a.tipo_doc IN ('AN','NC'), -1, 1) AS monto,
        (a.monto) * IF(a.tipo_doc IN ('AN','NC'), -1, 1) AS monto2, 
        (a.monto - a.abonos) * IF(a.tipo_doc IN ('AN','NC'), -1, 1) AS saldo, 
        ROUND((a.monto - a.abonos) / a.dolarcambio, 2) * IF(a.tipo_doc IN ('AN','NC'), 1, -1) AS saldod,
        (a.vence < CURDATE()) * (a.tipo_doc IN ('FC','ND')) AS vencida, 
        DATEDIFF(CURDATE(), a.vence) AS dias, 
        a.transac, 
        IF(a.tipo_doc = 'ND' AND a.tipo_ref = 'NE', (SELECT entregado FROM snte WHERE numero = a.num_ref), c.entregado) AS entregado,
        IF(c.sindescu IN ('S','X','M'), 'X', ' ') AS conjunto, 
        a.id AS idsmov, 
        IF(a.tipo_doc = 'ND' AND a.tipo_ref = 'NE' AND a.num_ref <> '', (SELECT id FROM snte WHERE numero = a.num_ref), c.id ) AS sfacid,
        a.tipo_ref AS referenciadoc,
        a.dolarcambio AS tasadevolu,
        IF(a.tipo_doc='FC', IF(c.mfactura=1, 0, IF(c.mfactura>0, c.mfactura, b.mfactura)), IF(a.tipo_doc='ND', IF(f.mfactura=1, 0, IF(f.mfactura>0, f.mfactura, b.mfactura)), 0)) AS mfactura,
        IF(a.tipo_doc='FC', IF(c.mfactura=1, 'Si', 'No'), IF(a.tipo_doc='ND', IF(f.mfactura=1, 'Si', 'No'), 'No')) AS indexado,
        IF(a.tipo_doc = 'FC', IF(DATEDIFF(CURDATE(),a.vence) > 5, (((a.monto-a.abonos)/ a.dolarcambio)+ (a.montod*0.10)) , 0), 0) AS montodfull,
        IF(a.tipo_doc = 'FC', IF(DATEDIFF(CURDATE(), a.vence) > 5, a.montod * 0.10, 0), 0) AS permul
      FROM smov a 
      JOIN scli b ON a.cod_cli = b.cliente 
      LEFT JOIN sfac c ON a.transac = c.transac AND a.numero = c.numero
      LEFT JOIN itrecla d ON c.numero = d.factura
      LEFT JOIN recla e ON d.numero = e.numero
      LEFT JOIN snte AS f ON a.num_ref = f.numero AND a.tipo_ref = 'NE'
      WHERE a.abonos <> a.monto 
        AND a.tipo_doc IN ('AN','FC','ND','GI','NC') 
        AND b.email = ?
      GROUP BY a.numero
      ORDER BY a.tipo_doc, a.numero, vence
    `;

        try {
            console.log(`[INFO] Buscando estado de cuenta para email: ${email}`);
            const [results] = await pool.promise().query(query, [email]);

            // Compute additional fields
            const fbanco = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            for (let row of results) {
                row.ppago = await calppago(pool, row.idsmov, fbanco);
                row.difc = await caldifc(pool, row.idsmov, fbanco, row.ppago);
                row.difpp = await difpp(pool, row.idsmov, fbanco);
                row.rete = await calrete(pool, row.idsmov);
            }

            res.json(results);
        } catch (err) {
            console.error('⚠️ Error consultando estado de cuenta:', err);
            res.status(500).json({ error: 'Error al obtener el estado de cuenta', details: err.code });
        }
    });

    return router;
}
