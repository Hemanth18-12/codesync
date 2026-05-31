import { 
    auth, db,
    onAuthStateChanged,
    collection, doc, onSnapshot, updateDoc, deleteDoc, query, orderBy, addDoc, getDocs,
    serverTimestamp
} from './firebase-config.js';

let currentUserId = null;
let unsubscribeNotifs = null;

/**
 * Initialize the notifications system for a given user.
 * Call once after auth is confirmed.
 */
export function initNotifications(userId) {
    currentUserId = userId;
    listenForNotifications();
}

/**
 * Real-time listener on Firestore: notifications/{userId}/items
 */
function listenForNotifications() {
    if (!currentUserId) return;

    const notifsRef = collection(db, 'notifications', currentUserId, 'items');
    const q = query(notifsRef, orderBy('timestamp', 'desc'));

    unsubscribeNotifs = onSnapshot(q, (snapshot) => {
        const items = [];
        let unreadCount = 0;

        snapshot.forEach((docSnap) => {
            const data = { id: docSnap.id, ...docSnap.data() };
            items.push(data);
            if (!data.read) unreadCount++;
        });

        renderNotifications(items);
        updateBadge(unreadCount);
    }, (err) => {
        console.error('Notification listener error:', err);
    });
}

/**
 * Render notification items into the #notif-list element.
 */
function renderNotifications(items) {
    const list = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    if (!list) return;

    if (items.length === 0) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
    }

    empty?.classList.add('hidden');
    list.innerHTML = '';

    items.forEach((item) => {
        const el = document.createElement('div');
        el.className = `notif-item${item.read ? '' : ' unread'}`;
        el.innerHTML = `
            <div class="notif-msg">${item.message || 'New notification'}</div>
            <span class="notif-time">${formatRelativeTime(item.timestamp?.toDate?.() || new Date())}</span>
        `;
        el.addEventListener('click', () => markAsRead(item.id));
        list.appendChild(el);
    });
}

/**
 * Update the notification badge on the bell icon.
 */
function updateBadge(count) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;

    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/**
 * Mark a single notification as read in Firestore.
 */
async function markAsRead(notifId) {
    if (!currentUserId) return;
    try {
        const ref = doc(db, 'notifications', currentUserId, 'items', notifId);
        await updateDoc(ref, { read: true });
    } catch (err) {
        console.error('Error marking notification as read:', err);
    }
}

/**
 * Delete all notification documents for the current user.
 */
export async function clearAllNotifications() {
    if (!currentUserId) return;
    try {
        const notifsRef = collection(db, 'notifications', currentUserId, 'items');
        const snapshot = await getDocs(notifsRef);
        const deletes = snapshot.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletes);
    } catch (err) {
        console.error('Error clearing notifications:', err);
    }
}

/**
 * Create a notification document for any user.
 * Can be called from editor.js, dashboard.js, etc.
 */
export async function createNotification(userId, message, type = 'info', relatedId = '') {
    if (!userId) return;
    try {
        const notifsRef = collection(db, 'notifications', userId, 'items');
        await addDoc(notifsRef, {
            message,
            type,
            relatedId,
            read: false,
            timestamp: serverTimestamp()
        });
    } catch (err) {
        console.error('Error creating notification:', err);
    }
}

/**
 * Stop the active Firestore listener (call on logout or page unload).
 */
export function stopNotifications() {
    if (unsubscribeNotifs) {
        unsubscribeNotifs();
        unsubscribeNotifs = null;
    }
}

// ── Auto-init and "Clear All" button wiring ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Wire the "Clear All" button if present on the page
    const clearBtn = document.getElementById('clear-notifs');
    clearBtn?.addEventListener('click', async () => {
        await clearAllNotifications();
    });

    // Auto-init when auth state is known
    onAuthStateChanged(auth, (user) => {
        if (user) {
            initNotifications(user.uid);
        } else {
            stopNotifications();
            currentUserId = null;
        }
    });
});

// ── Utility ───────────────────────────────────────────────────────────────────
function formatRelativeTime(date) {
    const diff = date - new Date();
    const absDiff = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

    if (absDiff < 60_000)       return rtf.format(Math.round(diff / 1000), 'second');
    if (absDiff < 3_600_000)    return rtf.format(Math.round(diff / 60_000), 'minute');
    if (absDiff < 86_400_000)   return rtf.format(Math.round(diff / 3_600_000), 'hour');
    return rtf.format(Math.round(diff / 86_400_000), 'day');
}
