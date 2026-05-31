import { rtdb, ref, set, remove, get } from './firebase-config.js';
import { currentRoomId, isReadOnly } from './editor.js';

let localDirectoryHandle = null;
export let localFilesMap = new Map(); // path -> FileHandle

const btnOpenFolder = document.getElementById('btn-open-folder');
const btnOpenFolderCenter = document.getElementById('btn-open-folder-center');
const fileTreeContainer = document.getElementById('file-tree');
const tabsContainer = document.getElementById('editor-tabs');

// Expose openFile to global scope so inline onclick works
window.openLocalFile = async (path) => {
    if (isReadOnly) {
        alert("This room is read-only. You cannot open or sync local files.");
        return;
    }
    
    const handle = localFilesMap.get(path);
    if (!handle) return;
    
    try {
        const file = await handle.getFile();
        const content = await file.text();
        
        // Ensure language sync
        const ext = path.split('.').pop().toLowerCase();
        let lang = 'plaintext';
        if (['js', 'jsx'].includes(ext)) lang = 'javascript';
        else if (['ts', 'tsx'].includes(ext)) lang = 'typescript';
        else if (ext === 'py') lang = 'python';
        else if (ext === 'html') lang = 'html';
        else if (ext === 'css') lang = 'css';
        else if (ext === 'json') lang = 'json';
        else if (ext === 'md') lang = 'markdown';
        
        // Write to Firebase RTDB to sync with others
        await set(ref(rtdb, `rooms/${currentRoomId}/workspace/${path.replace(/\//g, '_')}`), {
            content: content,
            language: lang,
            originalPath: path
        });
        
        // The real-time listener in rooms.js will pick this up and open the tab
    } catch (e) {
        console.error("Error reading file", e);
    }
};

async function openFolder() {
    if (isReadOnly) {
        alert("This room is read-only.");
        return;
    }
    
    try {
        if (!window.showDirectoryPicker) {
            alert("Your browser does not support the File System Access API. Please use Chrome, Edge, or Opera.");
            return;
        }
        
        localDirectoryHandle = await window.showDirectoryPicker();
        localFilesMap.clear();
        fileTreeContainer.innerHTML = '';
        
        await readDirectory(localDirectoryHandle, '', fileTreeContainer);
        
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            alert("Failed to open directory.");
        }
    }
}

async function readDirectory(dirHandle, path, parentElement) {
    const entries = [];
    for await (const entry of dirHandle.values()) {
        // Skip common ignored folders
        if (['node_modules', '.git', '.firebase', 'dist', 'build'].includes(entry.name)) continue;
        entries.push(entry);
    }
    
    // Sort: Folders first, then alphabetically
    entries.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === 'directory' ? -1 : 1;
    });

    for (const entry of entries) {
        const currentPath = path ? `${path}/${entry.name}` : entry.name;
        
        if (entry.kind === 'directory') {
            // Create Folder DOM
            const folderDiv = document.createElement('div');
            folderDiv.className = 'folder-item';
            folderDiv.innerHTML = `<span class="file-icon">📁</span> ${entry.name}`;
            
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'folder-children';
            
            folderDiv.onclick = () => {
                folderDiv.classList.toggle('open');
            };
            
            parentElement.appendChild(folderDiv);
            parentElement.appendChild(childrenContainer);
            
            // Recurse
            await readDirectory(entry, currentPath, childrenContainer);
        } else {
            // Create File DOM
            localFilesMap.set(currentPath, entry);
            
            const fileDiv = document.createElement('div');
            fileDiv.className = 'file-item';
            fileDiv.setAttribute('data-path', currentPath);
            
            let icon = '📄';
            if(entry.name.endsWith('.js')) icon = '📜';
            else if(entry.name.endsWith('.html')) icon = '🌐';
            else if(entry.name.endsWith('.css')) icon = '🎨';
            else if(entry.name.endsWith('.py')) icon = '🐍';
            else if(entry.name.endsWith('.json')) icon = '📦';
            
            fileDiv.innerHTML = `<span class="file-icon">${icon}</span> ${entry.name}`;
            
            fileDiv.onclick = () => window.openLocalFile(currentPath);
            
            parentElement.appendChild(fileDiv);
        }
    }
}

if (btnOpenFolder) btnOpenFolder.addEventListener('click', openFolder);
if (btnOpenFolderCenter) btnOpenFolderCenter.addEventListener('click', openFolder);

// Expose saving functionality back to local FS
export async function saveToLocalFile(path, content) {
    if (!localDirectoryHandle) return; // Not using local FS
    
    const handle = localFilesMap.get(path);
    if (!handle) return;
    
    try {
        // Request permission if needed
        const permission = await handle.queryPermission({mode: 'readwrite'});
        if (permission !== 'granted') {
            const newPermission = await handle.requestPermission({mode: 'readwrite'});
            if (newPermission !== 'granted') return;
        }
        
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
    } catch (e) {
        console.error("Failed to save to local file system", e);
    }
}
