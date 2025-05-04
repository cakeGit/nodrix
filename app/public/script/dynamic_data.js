const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/data`);

const existingCharts = {};

function populatePieChart(canvasId, keyValueList) {
    if (existingCharts[canvasId]) {
        existingCharts[canvasId].data.labels = keyValueList.map(item => item.key);
        existingCharts[canvasId].data.datasets[0].data = keyValueList.map(item => item.value);
        existingCharts[canvasId].update();
    } else {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.error(`Canvas with ID "${canvasId}" not found.`);
            return;
        }

        const ctx = canvas.getContext('2d');
        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: keyValueList.map(item => item.key),
                datasets: [{
                    data: keyValueList.map(item => item.value),
                    backgroundColor: keyValueList.map(() => getRandomColor()),
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                },
            },
        });

        existingCharts[canvasId] = chart;
    }
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

socket.addEventListener('message', (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log('Received stream data:', data);
        document.getElementById("streamdump").innerText = JSON.stringify(data, null, 2);
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
});
