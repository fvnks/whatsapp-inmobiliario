const cron = require('node-cron');
const { query } = require('../config/database');
const { 
    getSheetInfo, 
    getSheetDataWithRowIndices, 
    updateSheetRowByUniqueId, 
    COLUMN_MAPPING
} = require('./googleSheetService');
const { sendMessage } = require('./whatsappBot');
const moment = require('moment'); // Para manejar fechas fácilmente

// Configuración del Cron Job (ej: todos los días a las 9:00 AM)
// Formato: 'segundo minuto hora día-mes mes día-semana'
// Ver https://crontab.guru/ para ayuda
const CRON_SCHEDULE = '0 9 * * * '; // Todos los días a las 9:00 AM

let designatedSheetId = null;
let targetSheetName = null;
let isSchedulerRunning = false;

/**
 * Obtiene y cachea la hoja/pestaña designada para logs.
 */
async function loadDesignatedSheetInfo() {
    try {
        const [designatedSheets] = await query(
            'SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1'
        );
        if (designatedSheets && designatedSheets.length > 0) {
            const sheetId = designatedSheets[0].sheet_id;
            const sheetInfo = await getSheetInfo(sheetId);
            if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                designatedSheetId = sheetId;
                targetSheetName = sheetInfo.sheets[0].title;
                console.log(`[Scheduler] Hoja de logs cargada: ID=${designatedSheetId}, Pestaña=${targetSheetName}`);
                return true;
            } else {
                console.error('[Scheduler] Error: La hoja designada no tiene pestañas.');
            }
        } else {
            console.warn('[Scheduler] No hay hoja designada para logs de propiedades.');
        }
    } catch (error) {
        console.error('[Scheduler] Error cargando información de hoja designada:', error);
    }
    designatedSheetId = null;
    targetSheetName = null;
    return false;
}

/**
 * Lógica principal del seguimiento.
 */
async function performFollowUps() {
    console.log('[Scheduler] Ejecutando tarea de seguimiento...');
    isSchedulerRunning = true;

    if (!designatedSheetId || !targetSheetName) {
        console.log('[Scheduler] Intentando recargar info de hoja designada...');
        const loaded = await loadDesignatedSheetInfo();
        if (!loaded) {
            console.error('[Scheduler] No se pudo determinar hoja/pestaña de destino. Abortando seguimiento.');
            isSchedulerRunning = false;
            return;
        }
    }

    try {
        // Obtener todas las filas (A:AA para cubrir todas las columnas definidas)
        const activeRows = await getSheetDataWithRowIndices(designatedSheetId, targetSheetName, 'A:AA');
        
        const now = moment(); // Fecha y hora actual
        let followUpsSent = 0;

        for (const { rowIndex, rowData } of activeRows) {
            // Extraer datos relevantes de la fila usando COLUMN_MAPPING
            const uniqueId = rowData[COLUMN_MAPPING['UID'].index];
            const logStatus = rowData[COLUMN_MAPPING['Status'].index];
            // Asumimos que la columna 'Status' también guarda la etapa numérica del seguimiento.
            // Si es una columna diferente, se necesitaría un nuevo mapeo para 'FollowUpStage'.
            const followUpStage = parseInt(rowData[COLUMN_MAPPING['Status'].index] || '0', 10); 
            const fechaPublicacionStr = rowData[COLUMN_MAPPING['Fecha Publicacion'].index];
            const telefonoCorredor = rowData[COLUMN_MAPPING['Telefono Corredor'].index]; 

            if (logStatus !== 'Nuevo' && logStatus !== 'Activo') { // Solo seguir si está 'Nuevo' o 'Activo' (o el estado que uses para pendiente)
                // console.log(`[Scheduler] Saltando ${uniqueId}, estado: ${logStatus}`);
                continue; 
            }
            if (!uniqueId || !fechaPublicacionStr || !telefonoCorredor) {
                console.warn(`[Scheduler] Datos incompletos para fila ${rowIndex}, UID: ${uniqueId}. Saltando.`);
                continue; 
            }

            const fechaPublicacion = moment(fechaPublicacionStr, 'YYYY-MM-DD'); // Ajustar al formato en que se guarda
            if (!fechaPublicacion.isValid()) {
                console.warn(`[Scheduler] Fecha de publicación inválida para ${uniqueId}: ${fechaPublicacionStr}`);
                continue;
            }

            const daysSincePublication = now.diff(fechaPublicacion, 'days');
            let shouldSendFollowUp = false;
            let nextStageString = logStatus; // Por defecto mantiene el estado actual si no hay cambio de etapa
            let nextStageNumeric = followUpStage; // Para la lógica de días

            const baseMessage = `Hola! Respecto a tu publicación con ID [${uniqueId}], ¿ya se concretó (arriendo/venta/compra)? Responde "Sí" o "No".`;
            let followUpMessage = '';

            // Lógica de seguimiento (ahora usando valores numéricos para las etapas)
            // Etapa 0 (Nuevo/Activo inicial) -> Etapa 1 (Primer seguimiento)
            if (followUpStage === 0 && daysSincePublication >= 3) { 
                shouldSendFollowUp = true;
                nextStageNumeric = 1;
                followUpMessage = `Han pasado 3 días. ${baseMessage}`;
            // Etapa 1 -> Etapa 2
            } else if (followUpStage === 1 && daysSincePublication >= 5) { // Ej: 3 (etapa0) + 2 días
                shouldSendFollowUp = true;
                nextStageNumeric = 2;
                followUpMessage = `Han pasado 5 días. ${baseMessage}`;
            // Etapa 2 -> Etapa 3 (Diario)
            } else if (followUpStage === 2 && daysSincePublication >= 7) { // Ej: 5 (etapa1) + 2 días
                shouldSendFollowUp = true;
                nextStageNumeric = 3; 
                followUpMessage = `Verificación (7 días). ${baseMessage}`;
            // Etapa 3 (Diario) -> Sigue en Etapa 3
            } else if (followUpStage === 3 && daysSincePublication >= (7 + (nextStageNumeric - 2)) ) { // Ejemplo para enviar cada día después de la etapa 2
                 // Para que esto funcione bien, necesitaríamos leer la 'Fecha del Último Seguimiento'
                 // y asegurarnos que no se envió uno hoy.
                 // Por simplicidad, asumimos que el cron corre una vez y esto avanza la etapa.
                 // O una lógica más simple: enviar si es etapa 3 y ha pasado al menos 1 día desde el último.
                 // Para el ejemplo, mantendremos la lógica de daysSincePublication para el avance general.
                const lastFollowUpStr = rowData[COLUMN_MAPPING['Fecha del Último Seguimiento'].index];
                const lastFollowUpDate = lastFollowUpStr ? moment(lastFollowUpStr) : null;
                // Solo enviar si no hay último seguimiento o si el último fue antes de hoy
                if (!lastFollowUpDate || !lastFollowUpDate.isSame(now, 'day')) {
                    shouldSendFollowUp = true;
                    nextStageNumeric = 3; // Permanece en etapa diaria pero se registra el envío
                    followUpMessage = `Verificación diaria. ${baseMessage}`;
                }
            }

            // El estado en la hoja puede ser 'Nuevo', 'Activo (Etapa X)', 'Cerrado'. 
            // Usaremos números para `nextStageNumeric` y actualizaremos `Status` basado en esto.
            if (shouldSendFollowUp) {
                nextStageString = `Activo (Etapa ${nextStageNumeric})`; // Actualizar el string del estado

                console.log(`[Scheduler] Enviando seguimiento (Etapa ${nextStageNumeric}) para ${uniqueId} a ${telefonoCorredor}`);
                const recipientId = `${telefonoCorredor.replace(/\D/g, '')}@c.us`; // Limpiar y añadir @c.us
                try {
                    await sendMessage(recipientId, followUpMessage);
                    
                    const updates = {};
                    updates[COLUMN_MAPPING['Status'].header] = nextStageString; // Actualizar con el string de estado
                    updates[COLUMN_MAPPING['Fecha del Último Seguimiento'].header] = now.format('YYYY-MM-DD HH:mm:ss');
                    
                    await updateSheetRowByUniqueId(designatedSheetId, targetSheetName, uniqueId, updates);
                    console.log(`[Scheduler] Hoja actualizada para ${uniqueId} a estado '${nextStageString}'.`);
                    followUpsSent++;

                } catch (sendError) {
                    console.error(`[Scheduler] Error enviando mensaje a ${recipientId} para ${uniqueId}:`, sendError.message);
                }
            }
        }
        console.log(`[Scheduler] Tarea completada. ${followUpsSent} seguimientos enviados.`);

    } catch (error) {
        console.error('[Scheduler] Error durante la ejecución de la tarea:', error);
    } finally {
        isSchedulerRunning = false;
    }
}

/**
 * Inicia el scheduler.
 */
function startScheduler() {
    console.log('[Scheduler] Iniciando servicio de programación...');
    // Cargar la info de la hoja al iniciar
    loadDesignatedSheetInfo().then(() => {
        // Programar la tarea
        cron.schedule(CRON_SCHEDULE, () => {
            if (!isSchedulerRunning) {
                performFollowUps();
            } else {
                console.log('[Scheduler] La tarea anterior aún se está ejecutando. Saltando ciclo.');
            }
        }, {
            scheduled: true,
            timezone: "America/Santiago" // Ajustar a tu zona horaria
        });
        console.log(`[Scheduler] Tarea programada para ejecutarse según: ${CRON_SCHEDULE} (Zona Horaria: America/Santiago)`);
    });
}

module.exports = { startScheduler }; 