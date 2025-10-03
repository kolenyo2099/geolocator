/* ========== STICKY NOTES ========== */
let stickyNotes = [];
let draggedNote = null;
let dragOffsetNoteX = 0;
let dragOffsetNoteY = 0;
let noteIdCounter = 0;

function createStickyNote(x, y, container) {
  const noteId = `note-${noteIdCounter++}`;
  
  const noteDiv = document.createElement('div');
  noteDiv.className = 'sticky-note';
  noteDiv.id = noteId;
  noteDiv.style.left = x + 'px';
  noteDiv.style.top = y + 'px';
  
  noteDiv.innerHTML = `
    <div class="sticky-note-header">
      <span class="sticky-note-drag-handle">⠿⠿</span>
      <button class="sticky-note-delete" onclick="deleteStickyNote('${noteId}')" title="Delete note">×</button>
    </div>
    <textarea class="sticky-note-textarea" placeholder="Type your note here..." onclick="event.stopPropagation()"></textarea>
  `;
  
  container.appendChild(noteDiv);
  
  const note = {
    id: noteId,
    element: noteDiv,
    container: container
  };
  
  stickyNotes.push(note);
  
  // Make draggable
  const header = noteDiv.querySelector('.sticky-note-header');
  header.addEventListener('mousedown', (e) => startDragNote(e, note));
  
  // Focus textarea
  setTimeout(() => {
    noteDiv.querySelector('.sticky-note-textarea').focus();
  }, 100);
  
  return note;
}

function startDragNote(e, note) {
  e.preventDefault();
  e.stopPropagation();
  
  draggedNote = note;
  note.element.classList.add('dragging');
  
  const rect = note.element.getBoundingClientRect();
  const containerRect = note.container.getBoundingClientRect();
  
  dragOffsetNoteX = e.clientX - rect.left;
  dragOffsetNoteY = e.clientY - rect.top;
}

document.addEventListener('mousemove', (e) => {
  if (!draggedNote) return;
  
  e.preventDefault();
  const containerRect = draggedNote.container.getBoundingClientRect();
  
  let newX = e.clientX - containerRect.left - dragOffsetNoteX;
  let newY = e.clientY - containerRect.top - dragOffsetNoteY;
  
  // Keep within bounds
  newX = Math.max(0, Math.min(newX, containerRect.width - draggedNote.element.offsetWidth));
  newY = Math.max(0, Math.min(newY, containerRect.height - draggedNote.element.offsetHeight));
  
  draggedNote.element.style.left = newX + 'px';
  draggedNote.element.style.top = newY + 'px';
});

document.addEventListener('mouseup', () => {
  if (draggedNote) {
    draggedNote.element.classList.remove('dragging');
    draggedNote = null;
  }
});

function deleteStickyNote(noteId) {
  const note = stickyNotes.find(n => n.id === noteId);
  if (note) {
    note.element.remove();
    stickyNotes = stickyNotes.filter(n => n.id !== noteId);
  }
}
