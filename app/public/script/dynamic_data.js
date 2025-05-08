const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/data`);

const existingCharts = {};

function populatePieChart(canvasId, keyValueList, backgroundColor=null) {
    if (existingCharts[canvasId]) {
        existingCharts[canvasId].data.labels = keyValueList.map(item => item.key);
        existingCharts[canvasId].data.datasets[0].data = keyValueList.map(item => item.value);
        if (backgroundColor !== null) {
            existingCharts[canvasId].data.datasets[0].backgroundColor = backgroundColor;
        }
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
                    backgroundColor: backgroundColor || keyValueList.map(() => getRandomColor()),
                }],
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

function populateLineChart(canvasId, labels, data, borderColor=null, backgroundColor=null) {
    if (existingCharts[canvasId]) {
        existingCharts[canvasId].data.labels = labels;
        existingCharts[canvasId].data.datasets[0].data = data;
        if (borderColor !== null) {
            existingCharts[canvasId].data.datasets[0].borderColor = borderColor;
        }
        if (backgroundColor !== null) {
            existingCharts[canvasId].data.datasets[0].backgroundColor = backgroundColor;
        }
        existingCharts[canvasId].update();
    } else {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.error(`Canvas with ID "${canvasId}" not found.`);
            return;
        }

        const ctx = canvas.getContext('2d');
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
            labels: labels,
            datasets: [{
                data: data,
                borderColor: borderColor || 'rgba(75, 192, 192, 1)',
                backgroundColor: backgroundColor || 'rgba(75, 192, 192, 0.2)',
                fill: true,
            }],
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false,
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                    },
                    y: {
                        beginAtZero: true,
                        min: 0,
                        max: 1,
                    },
                },
            },
        });

        existingCharts[canvasId] = chart;
    }
}

socket.addEventListener('message', (event) => {
    try {
        const data = JSON.parse(event.data);
        console.log('Received stream data:', data);

        populatePieChart('cpu-usage-total-chart', [
            {key: "Used", value: data.os_cpu_usage.reduce((acc, val) => acc + val, 0)},
            {key: "Free", value: data.os_cpu_usage.length - data.os_cpu_usage.reduce((acc, val) => acc + val, 0)},
        ], ['#22ff99', '#333333']);
        
        populatePieChart('ram-usage-chart', [
            {key: "Used", value: data.os_memory_usage},
            {key: "Free", value: 1 - data.os_memory_usage},
        ], ['#9922ff', '#333333']);
        
        populatePieChart('nodrix-os-ram-usage-chart', [
            {key: "Nodrix", value: data.nodrix_memory_usage_of_os},
            {key: "OS", value: 1 - data.nodrix_memory_usage_of_os},
        ], ['#ff2299', '#333333']);

        populateLineChart('cpu-usage-graph', Object.keys(data.os_cpu_usage), data.os_cpu_usage, '#22ff99', 'rgba(34, 255, 153, 0.2)');

        document.getElementById("nodrix-ram-usage").innerText = data.nodrix_memory_usage_of_os.toFixed(2) * 100 + "%";

        document.getElementById("streamdump").innerText = JSON.stringify(data, null, 2);
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
});
