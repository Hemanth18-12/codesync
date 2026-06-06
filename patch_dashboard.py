import sys

def apply_dashboard_fixes():
    with open('js/dashboard.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # dashboard.js: loadOverviewData
    old_qOwner = "    const qOwner = query(collection(db, 'rooms'), where('ownerId', '==', currentUser.uid));"
    new_qOwner = '''    const qOwner = query(
      collection(db, 'rooms'), 
      where('owner', '==', currentUser.uid)
    );'''
    if old_qOwner in content:
        content = content.replace(old_qOwner, new_qOwner)
        print("Dashboard Fix 4 (qOwner) applied")

    old_qCollab = "    const qCollab = query(collection(db, 'rooms'), where('collaborators', 'array-contains', currentUser.uid));"
    new_qCollab = '''    // Note: collaborators is array of objects
    // so we query differently
    const qCollab = query(
      collection(db, 'rooms'),
      where('owner', '!=', currentUser.uid),
      limit(50)
    );'''
    if old_qCollab in content:
        content = content.replace(old_qCollab, new_qCollab)
        print("Dashboard Fix 4 (qCollab) applied")

    # renderRecentRooms: filter logic
    old_collab_filter = "    if (source === 'collab') recentCollabDocs = snapshot.docs.filter(d => d.data().ownerId !== currentUser.uid);"
    new_collab_filter = '''    if (source === 'collab') {
      recentCollabDocs = snapshot.docs.filter(d => {
        const data = d.data();
        // Skip own rooms
        if (data.owner === currentUser.uid) 
          return false;
        // Check if user is in collaborators
        return data.collaborators?.some(
          c => c.userId === currentUser.uid
        );
      });
    }'''
    if old_collab_filter in content:
        content = content.replace(old_collab_filter, new_collab_filter)
        print("Dashboard Fix 4 (collab filter) applied")

    # loadMyRooms: grid element ID
    old_grid = '''  const grid = 
    document.getElementById('rooms-grid')
    || document.getElementById('my-rooms-grid')
    || document.getElementById('recent-rooms')
    || document.querySelector('.rooms-grid')
    || document.querySelector(
      '[id*="rooms"]');'''
    new_grid = '''  const grid = 
    document.getElementById('my-rooms-grid')
    || document.getElementById('rooms-grid')
    || document.getElementById('recent-rooms')
    || document.querySelector('.rooms-grid')
    || document.querySelector(
      '[id*="rooms"]');'''
    if old_grid in content:
        content = content.replace(old_grid, new_grid)
        print("Dashboard Fix 4 (grid element ID) applied")

    # loadMyRooms: remove orderBy
    old_q_myrooms = '''    const q = query(
      collection(db, 'rooms'),
      where('owner', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(10)
    );'''
    new_q_myrooms = '''    const q = query(
      collection(db, 'rooms'),
      where('owner', '==', user.uid),
      limit(20)
    );'''
    if old_q_myrooms in content:
        content = content.replace(old_q_myrooms, new_q_myrooms)
        print("Dashboard Fix 4 (remove orderBy) applied")

    with open('js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(content)

def apply_rooms_fixes():
    with open('js/rooms.js', 'r', encoding='utf-8') as f:
        content = f.read()

    old_room_name = "        document.getElementById('room-name').innerText = roomData.name;"
    new_room_name = '''        document.getElementById('room-name').innerText = roomData.name;
        
        // Update workspace panel title
        const wsTitle = document.querySelector(
          '.sidebar-title span');
        if (wsTitle && wsTitle.textContent 
            === 'Workspace') {
          wsTitle.textContent = 
            (roomData.name || 'Workspace')
            .toUpperCase();
        }'''
    if old_room_name in content:
        content = content.replace(old_room_name, new_room_name)
        print("Rooms Fix 5 (workspace title) applied")

    with open('js/rooms.js', 'w', encoding='utf-8') as f:
        f.write(content)

apply_dashboard_fixes()
apply_rooms_fixes()
