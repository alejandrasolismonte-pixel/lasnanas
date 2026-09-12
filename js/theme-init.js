(() => {
  try {
    if (localStorage.getItem('lasnanas-theme') === 'day') {
      document.documentElement.dataset.theme = 'day';
    }
  } catch (_) {
    // El modo oscuro permanece como alternativa segura si no hay almacenamiento.
  }
})();
