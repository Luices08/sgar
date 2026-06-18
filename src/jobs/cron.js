const cron = require('node-cron');
const Invitation = require('../models/Invitation');

function initCronJobs() {
    // 11:59 PM todos los días
    cron.schedule('59 23 * * *', async () => {
        try {
            const result = await Invitation.updateMany(
                { estado: 'pendiente', tiempo_caducidad: { $lt: new Date() } },
                { $set: { estado: 'archivada', fechaResolucion: new Date() } }
            );
            console.log(`[CRON] ${result.modifiedCount} invitaciones expiradas fueron archivadas.`);
        } catch (err) {
            console.error('[CRON] Error', err);
        }
    });
}
module.exports = { initCronJobs };
