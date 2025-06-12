document.querySelector('form').addEventListener('submit', function(event) {
    event.preventDefault();

    const prompt = document.getElementById('prompt').value;
    fetch('/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `prompt=${encodeURIComponent(prompt)}`
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json(); // Получаем JSON с HTML, CSS и JS
    })
    .then(data => {
        // Заполняем textarea полученными данными
        document.getElementById('htmlCode').value = data.html;
        document.getElementById('cssCode').value = data.css;
        document.getElementById('jsCode').value = data.js;
        updateIframe(); // Обновляем iframe сразу после получения данных
    })
    .catch(error => {
        console.error('Error:', error);
        // Обработка ошибки
    });
});



// Добавляем обработчики событий input для обновления iframe при изменении кода
document.getElementById('htmlCode').addEventListener('input', updateIframe);
document.getElementById('cssCode').addEventListener('input', updateIframe);
document.getElementById('jsCode').addEventListener('input', updateIframe);

//  Первоначальное обновление iframe, если есть сгенерированный код
updateIframe();