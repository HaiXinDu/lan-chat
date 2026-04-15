const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000);
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        cb(null, `${timestamp}_${random}_${baseName}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// 聊天历史存储
const HISTORY_FILE = path.join(__dirname, '..', 'chat-history.json');

// 频道存储
const CHANNELS_FILE = path.join(__dirname, '..', 'channels.json');

// 频道数据
let channels = {};

// 系统默认频道（不可删除）
const SYSTEM_CHANNELS = ['综合聊天', '技术交流', '闲聊天地'];

// 加载频道数据
function loadChannels() {
    if (fs.existsSync(CHANNELS_FILE)) {
        try {
            const data = fs.readFileSync(CHANNELS_FILE, 'utf8');
            const loaded = JSON.parse(data);
            // 初始化用户集合
            for (let channelName in loaded) {
                loaded[channelName].users = new Set(loaded[channelName].users || []);
            }
            channels = loaded;
        } catch (error) {
            console.error('加载频道数据失败:', error);
            channels = {};
        }
    } else {
        // 创建默认频道
        channels = {
            '综合聊天': {
                users: new Set(),
                createdAt: new Date().toISOString(),
                isSystem: true
            },
            '技术交流': {
                users: new Set(),
                createdAt: new Date().toISOString(),
                isSystem: true
            },
            '闲聊天地': {
                users: new Set(),
                createdAt: new Date().toISOString(),
                isSystem: true
            }
        };
        saveChannels();
    }
}

// 保存频道数据
function saveChannels() {
    const data = {};
    for (let channelName in channels) {
        data[channelName] = {
            users: Array.from(channels[channelName].users),
            createdAt: channels[channelName].createdAt
        };
    }
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 保存聊天记录（按频道）
function saveChatRecord(message, channel) {
    let history = getChatHistory(channel);
    if (!history) history = [];
    history.push(message);
    
    const historyFile = channel ? 
        path.join(__dirname, '..', `chat-history-${channel}.json`) :
        HISTORY_FILE;
    
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
}

function getChatHistory(channel) {
    const historyFile = channel ? 
        path.join(__dirname, '..', `chat-history-${channel}.json`) :
        HISTORY_FILE;
    
    if (!fs.existsSync(historyFile)) {
        return [];
    }
    try {
        const data = fs.readFileSync(historyFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取聊天历史失败:', error);
        return [];
    }
}

// 用户名集合
const users = new Set();

// 加载频道数据
loadChannels();

// Socket.io 连接处理
io.on('connection', (socket) => {
    console.log('用户连接:', socket.id);
    socket.currentChannel = null;

    // 用户加入
    socket.on('join', (username) => {
        if (users.has(username)) {
            socket.emit('joinError', { message: '该用户名已被占用，请选择其他用户名' });
            return;
        }

        socket.username = username;
        users.add(username);

        io.emit('systemMessage', { message: `${username} 加入了聊天室`, type: 'join' });
        io.emit('userList', Array.from(users));

        // 发送频道列表
        socket.emit('channelList', getChannelList());

        // 发送用户频道信息
        io.emit('userChannels', getUserChannels());

        // 发送空聊天历史以显示聊天界面
        socket.emit('chatHistory', []);

        console.log(`用户 ${username} 加入聊天室`);
    });

    // 加入频道
    socket.on('joinChannel', (channelName) => {
        if (socket.currentChannel) {
            // 离开当前频道
            leaveChannel(socket);
        }

        if (!channels[channelName]) {
            socket.emit('channelError', { message: '频道不存在' });
            return;
        }

        // 加入新频道
        socket.join(channelName);
        socket.currentChannel = channelName;
        channels[channelName].users.add(socket.username);
        saveChannels();

        // 发送频道聊天历史
        socket.emit('chatHistory', getChatHistory(channelName));
        
        // 通知频道内用户
        io.to(channelName).emit('systemMessage', {
            message: `${socket.username} 加入了频道 "${channelName}"`,
            type: 'joinChannel',
            channel: channelName
        });

        // 更新频道列表（发送给所有用户）
        io.emit('channelList', getChannelList());

        // 更新用户频道信息
        io.emit('userChannels', getUserChannels());

        console.log(`用户 ${socket.username} 加入频道 ${channelName}`);
    });

    // 离开频道
    function leaveChannel(socket) {
        if (socket.currentChannel && channels[socket.currentChannel]) {
            channels[socket.currentChannel].users.delete(socket.username);
            saveChannels();

            // 通知频道内用户
            io.to(socket.currentChannel).emit('systemMessage', {
                message: `${socket.username} 离开了频道 "${socket.currentChannel}"`,
                type: 'leaveChannel',
                channel: socket.currentChannel
            });

            socket.leave(socket.currentChannel);
            socket.currentChannel = null;

            // 更新频道列表（发送给所有用户）
            io.emit('channelList', getChannelList());

            // 更新用户频道信息
            io.emit('userChannels', getUserChannels());
        }
    }

    // 聊天消息
    socket.on('chatMessage', (data) => {
        if (!socket.currentChannel) {
            socket.emit('error', { message: '请先加入一个频道' });
            return;
        }

        const message = {
            id: socket.id,
            username: socket.username,
            message: data.message,
            files: data.files,
            channel: socket.currentChannel,
            timestamp: new Date().toLocaleString('zh-CN')
        };
        
        saveChatRecord(message, socket.currentChannel);
        io.to(socket.currentChannel).emit('chatMessage', message);
    });

    // 创建频道
    socket.on('createChannel', (channelName) => {
        if (!channelName || channelName.trim() === '') {
            socket.emit('channelError', { message: '频道名称不能为空' });
            return;
        }

        channelName = channelName.trim();

        if (channels[channelName]) {
            socket.emit('channelError', { message: '频道已存在' });
            return;
        }

        channels[channelName] = {
            users: new Set(),
            createdAt: new Date().toISOString(),
            isSystem: false,
            creator: socket.username
        };
        saveChannels();

        io.emit('channelList', getChannelList());
        socket.emit('channelCreated', { channelName });

        console.log(`频道 ${channelName} 创建成功`);
    });

    // 删除频道
    socket.on('deleteChannel', (channelName) => {
        if (!channels[channelName]) {
            socket.emit('channelError', { message: '频道不存在' });
            return;
        }

        // 检查是否为系统频道
        if (channels[channelName].isSystem) {
            socket.emit('channelError', { message: '系统默认频道不能删除' });
            return;
        }

        // 通知该频道的所有用户离开
        io.to(channelName).emit('systemMessage', {
            message: `频道 "${channelName}" 已被删除`,
            type: 'deleteChannel'
        });

        // 强制该频道的所有用户离开
        io.sockets.sockets.forEach(s => {
            if (s.currentChannel === channelName) {
                s.leave(channelName);
                s.currentChannel = null;
            }
        });

        // 删除频道
        delete channels[channelName];
        saveChannels();

        // 更新频道列表和用户频道信息
        io.emit('channelList', getChannelList());
        io.emit('userChannels', getUserChannels());

        socket.emit('channelDeleted', { channelName });

        console.log(`频道 ${channelName} 删除成功`);
    });

    // 用户断开连接
    socket.on('disconnect', () => {
        if (socket.username) {
            users.delete(socket.username);

            // 离开频道
            if (socket.currentChannel) {
                leaveChannel(socket);
                io.emit('channelList', getChannelList());
            }

            // 更新用户频道信息
            io.emit('userChannels', getUserChannels());

            io.emit('systemMessage', { message: `${socket.username} 离开了聊天室`, type: 'leave' });
            io.emit('userList', Array.from(users));
            console.log(`用户 ${socket.username} 离开聊天室`);
        }
    });
});

// 获取频道列表
function getChannelList() {
    const list = {};
    for (let channelName in channels) {
        list[channelName] = {
            users: channels[channelName].users.size,
            createdAt: channels[channelName].createdAt,
            isSystem: channels[channelName].isSystem || false,
            creator: channels[channelName].creator || null
        };
    }
    return list;
}

// 获取用户频道信息
function getUserChannels() {
    const userChannels = {};
    io.sockets.sockets.forEach(socket => {
        if (socket.username && socket.currentChannel) {
            userChannels[socket.username] = socket.currentChannel;
        }
    });
    return userChannels;
}

// 文件上传接口
app.post('/upload', upload.array('files', 100), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    const files = req.files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        uploadTime: new Date().toISOString(),
        url: `/uploads/${file.filename}`,
        relativePath: file.originalname // 文件夹上传时会替换
    }));

    res.json({ success: true, files });
});

// 获取文件列表
app.get('/api/files', (req, res) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
        return res.json({ success: true, files: [] });
    }

    const files = fs.readdirSync(uploadDir).map(filename => {
        const filepath = path.join(uploadDir, filename);
        const stats = fs.statSync(filepath);
        
        return {
            filename: filename,
            size: stats.size,
            uploadTime: stats.mtime.toISOString()
        };
    });

    res.json({ success: true, files });
});

// 删除文件
app.delete('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, '..', 'uploads', filename);
    
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        res.json({ success: true, message: '文件删除成功' });
    } else {
        res.status(404).json({ success: false, error: '文件不存在' });
    }
});

// 动态端口选择
function findAvailablePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        
        server.on('error', () => {
            server.close();
            findAvailablePort(startPort + 1).then(resolve).catch(reject);
        });
        
        server.listen(startPort, () => {
            server.close();
            resolve(startPort);
        });
    });
}

// 启动服务器
const START_PORT = process.env.PORT || 3000;

findAvailablePort(START_PORT).then(port => {
    server.listen(port, '0.0.0.0', () => {
        console.log('=================================');
        console.log('聊天室服务器已启动');
        console.log('=================================');
        console.log(`本地访问: http://localhost:${port}`);
        
        // 获取本机IP
        const os = require('os');
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`网络访问: http://${iface.address}:${port}`);
                }
            }
        }
        
        console.log('=================================');
    });
}).catch(err => {
    console.error('启动服务器失败:', err);
    process.exit(1);
});