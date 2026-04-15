class ChatApp {
    constructor() {
        this.socket = null;
        this.username = '';
        this.isConnected = false;
        this.selectedFiles = [];
        this.currentChannel = null;
        this.userChannels = {};
        this.allUsers = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupTextareaAutoResize();
        this.connectToServer();
    }

    setupEventListeners() {
        // 登录相关
        const usernameInput = document.getElementById('usernameInput');
        const joinBtn = document.getElementById('joinBtn');

        joinBtn.addEventListener('click', () => this.joinChat());
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinChat();
            }
        });

        // 聊天相关
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const attachBtn = document.getElementById('attachBtn');

        sendBtn.addEventListener('click', () => this.sendMessage());
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 文件相关
        const fileInput = document.getElementById('fileInput');
        const selectFile = document.getElementById('selectFile');
        const selectFolder = document.getElementById('selectFolder');
        const folderInput = document.getElementById('folderInput');

        attachBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAttachMenu();
        });

        selectFile.addEventListener('click', () => {
            fileInput.click();
            this.toggleAttachMenu(false);
        });

        selectFolder.addEventListener('click', () => {
            folderInput.click();
            this.toggleAttachMenu(false);
        });

        // 点击其他地方关闭菜单
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('attachMenu');
            const btn = document.getElementById('attachBtn');
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        folderInput.addEventListener('change', (e) => this.handleFileSelect(e, true));

        // 导出聊天记录
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.addEventListener('click', () => this.exportChatHistory());

        // 查看已保存文件
        const filesBtn = document.getElementById('filesBtn');
        filesBtn.addEventListener('click', () => this.openFilesModal());

        // 创建频道
        const createChannelBtn = document.getElementById('createChannelBtn');
        createChannelBtn.addEventListener('click', () => this.openCreateChannelModal());

        const confirmCreateChannel = document.getElementById('confirmCreateChannel');
        confirmCreateChannel.addEventListener('click', () => this.createChannel());

        const newChannelName = document.getElementById('newChannelName');
        newChannelName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.createChannel();
            }
        });
    }

    connectToServer() {
        this.socket = io();

        this.socket.on('connect', () => {
            this.isConnected = true;
            this.updateConnectionStatus('connected');
            console.log('连接到服务器成功');
        });

        this.socket.on('connect_error', (error) => {
            console.error('连接错误:', error);
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
        });

        this.socket.on('reconnect', () => {
            console.log('重新连接到服务器');
            this.isConnected = true;
            this.updateConnectionStatus('connected');
        });

        this.socket.on('joinError', (error) => {
            this.showAlert(error.message);
            // 显示聊天界面
            document.getElementById('loginForm').classList.remove('hidden');
            document.getElementById('chatContainer').classList.add('hidden');
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.updateConnectionStatus('disconnected');
            this.showSystemMessage('与服务器连接断开', 'error');
        });

        this.socket.on('userList', (users) => {
            this.allUsers = users;
            this.updateTotalUsers(users.length);
            // 用户列表由频道列表事件处理，不需要单独更新
        });

        this.socket.on('chatMessage', (data) => {
            this.displayMessage(data);
        });

        this.socket.on('chatHistory', (history) => {
            // 首次成功加入后显示聊天界面
            this.onJoinSuccess();
            this.loadChatHistory(history);
        });

        this.socket.on('systemMessage', (data) => {
            this.showSystemMessage(data.message, data.type);
        });

        // 频道相关事件
        this.socket.on('channelList', (channels) => {
            this.updateChannelList(channels);
        });

        this.socket.on('channelError', (error) => {
            this.showAlert(error.message);
        });

        this.socket.on('channelCreated', (data) => {
            this.showAlert(`频道 "${data.channelName}" 创建成功`);
            this.joinChannel(data.channelName);
        });

        this.socket.on('channelDeleted', (data) => {
            this.showAlert(`频道 "${data.channelName}" 已删除`);
            if (this.currentChannel === data.channelName) {
                this.currentChannel = null;
                document.getElementById('currentChannelDisplay').textContent = '请选择频道';
                document.getElementById('messages').innerHTML = '';
            }
        });

        this.socket.on('userChannels', (userChannels) => {
            this.updateUserChannels(userChannels);
        });
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        statusElement.className = `status ${status}`;
        statusElement.textContent = status === 'connected' ? '已连接' : '未连接';
    }

    updateTotalUsers(count) {
        const totalUsersElement = document.getElementById('totalUsers');
        totalUsersElement.textContent = `总人数: ${count}`;
    }

    joinChat() {
        const usernameInput = document.getElementById('usernameInput');
        const username = usernameInput.value.trim();

        console.log('joinChat 调用', { username, isConnected: this.isConnected, socket: !!this.socket });

        if (!username) {
            this.showAlert('请输入用户名');
            return;
        }

        if (!this.isConnected) {
            this.showAlert('服务器未连接，请稍后重试');
            return;
        }

        this.username = username;

        // 通知服务器用户加入（等待服务器验证）
        this.socket.emit('join', username);
    }

    onJoinSuccess() {
        // 隐藏登录界面，显示聊天界面
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('chatContainer').classList.remove('hidden');

        // 如果还没有加入频道，显示欢迎消息
        if (!this.currentChannel) {
            this.showSystemMessage('欢迎加入！请在左侧选择一个频道开始聊天', 'info');
        }
    }

    async sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();

        if (!message && this.selectedFiles.length === 0) {
            return;
        }

        if (!this.isConnected) {
            this.showAlert('连接已断开，无法发送消息');
            return;
        }

        if (!this.currentChannel) {
            this.showAlert('请先加入一个频道');
            return;
        }

        // 如果有文件，先上传文件
        let uploadedFiles = [];
        if (this.selectedFiles.length > 0) {
            uploadedFiles = await this.uploadFiles();
            if (!uploadedFiles) {
                this.showAlert('文件上传失败');
                return;
            }
        }

        // 发送消息到服务器
        this.socket.emit('chatMessage', { 
            message,
            files: uploadedFiles
        });
        
        // 清空输入框和文件选择
        messageInput.value = '';
        messageInput.style.height = 'auto';
        this.clearFileSelection();
        messageInput.focus();
    }

    displayMessage(data, scroll = true) {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        
        const isSelf = data.id === this.socket.id;
        messageElement.className = `message ${isSelf ? 'self' : 'other'}`;
        
        const header = document.createElement('div');
        header.className = 'message-header';
        header.textContent = `${data.username} - ${data.timestamp}`;
        
        messageElement.appendChild(header);
        
        // 添加文本内容
        if (data.message) {
            const text = document.createElement('div');
            text.className = 'message-text';
            text.textContent = data.message;
            messageElement.appendChild(text);
        }
        
        // 添加文件内容
        if (data.files && data.files.length > 0) {
            const fileContainer = document.createElement('div');
            fileContainer.className = 'file-message';
            
            const fileHeader = document.createElement('div');
            fileHeader.className = 'file-message-header';
            fileHeader.textContent = `📎 ${data.files.length} 个文件`;
            fileContainer.appendChild(fileHeader);
            
            data.files.forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-message-content';
                
                let filePath = '';
                if (file.relativePath && file.relativePath !== file.originalName) {
                    filePath = file.relativePath.replace(file.originalName, '');
                }
                
                fileItem.innerHTML = `
                    <span class="file-icon">${this.getFileIcon(file.mimetype)}</span>
                    <div class="file-info-text">
                        <span class="file-name">${file.originalName}</span>
                        ${filePath ? `<span class="file-path">${filePath}</span>` : ''}
                        <span class="file-size">${this.formatFileSize(file.size)}</span>
                    </div>
                    <a href="${file.url}" download="${file.originalName}" class="file-download-btn">
                        ⬇ 下载
                    </a>
                `;
                fileContainer.appendChild(fileItem);
            });
            
            messageElement.appendChild(fileContainer);
        }
        
        messagesContainer.appendChild(messageElement);
        
        if (scroll) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    showSystemMessage(message, type = 'system') {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        
        messageElement.className = 'message system';
        messageElement.textContent = message;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    loadChatHistory(history) {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        if (history.length === 0) {
            this.showSystemMessage(`暂无聊天记录`, 'info');
            return;
        }
        
        this.showSystemMessage(`已加载 ${history.length} 条历史消息`, 'info');
        
        history.forEach(message => {
            this.displayMessage(message, false);
        });
        
        // 滚动到底部
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }

    updateUserList(users) {
        // 用户列表现在集成在频道列表中，不需要单独处理
    }

    updateUserChannels(userChannels) {
        this.userChannels = userChannels;
        // 更新频道列表以显示用户信息
        this.updateChannelList(this.channelsData);
    }

    setupTextareaAutoResize() {
        const messageInput = document.getElementById('messageInput');
        
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });
    }

    toggleAttachMenu(show) {
        const menu = document.getElementById('attachMenu');
        if (typeof show === 'boolean') {
            show ? menu.classList.add('show') : menu.classList.remove('show');
        } else {
            menu.classList.toggle('show');
        }
    }

    handleFileSelect(event, isFolder = false) {
        const files = Array.from(event.target.files);
        
        // 为文件夹中的文件添加路径信息
        files.forEach(file => {
            if (isFolder && file.webkitRelativePath) {
                file.relativePath = file.webkitRelativePath;
                file.isFolderFile = true;
            }
        });
        
        this.selectedFiles = files;
        this.displayFilePreview();
    }

    displayFilePreview() {
        const filePreview = document.getElementById('filePreview');
        
        if (this.selectedFiles.length === 0) {
            filePreview.classList.add('hidden');
            return;
        }
        
        filePreview.classList.remove('hidden');
        filePreview.innerHTML = '';
        
        // 按文件夹分组
        const folderGroups = {};
        let fileCount = 0;
        
        this.selectedFiles.forEach((file, index) => {
            if (file.isFolderFile && file.relativePath) {
                const folderName = file.relativePath.split('/')[0];
                if (!folderGroups[folderName]) {
                    folderGroups[folderName] = [];
                }
                folderGroups[folderName].push({ file, index });
            } else {
                if (!folderGroups['files']) {
                    folderGroups['files'] = [];
                }
                folderGroups['files'].push({ file, index });
            }
        });
        
        // 显示文件
        Object.keys(folderGroups).forEach(groupName => {
            const group = folderGroups[groupName];
            
            if (groupName !== 'files') {
                // 文件夹标题
                const folderHeader = document.createElement('div');
                folderHeader.className = 'file-folder-header';
                folderHeader.innerHTML = `<span>📁 ${groupName}</span> <span class="file-count">(${group.length} 个文件)</span>`;
                filePreview.appendChild(folderHeader);
            }
            
            group.forEach(({ file, index }) => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                
                let filePath = '';
                if (file.isFolderFile && file.relativePath) {
                    filePath = file.relativePath.replace(file.name, '');
                }
                
                fileItem.innerHTML = `
                    <div class="file-info">
                        <span class="file-icon">${this.getFileIcon(file.type)}</span>
                        <div class="file-details">
                            <div class="file-name">${file.name}</div>
                            ${filePath ? `<div class="file-path">${filePath}</div>` : ''}
                            <div class="file-size">${this.formatFileSize(file.size)}</div>
                        </div>
                    </div>
                    <button class="file-remove" onclick="chatApp.removeFile(${index})">删除</button>
                `;
                filePreview.appendChild(fileItem);
            });
        });
    }

    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.displayFilePreview();
        
        // 清空文件输入框
        const fileInput = document.getElementById('fileInput');
        fileInput.value = '';
    }

    clearFileSelection() {
        this.selectedFiles = [];
        this.displayFilePreview();
        const fileInput = document.getElementById('fileInput');
        fileInput.value = '';
    }

    async uploadFiles() {
        if (this.selectedFiles.length === 0) return [];
        
        const formData = new FormData();
        this.selectedFiles.forEach(file => {
            formData.append('files', file);
        });
        
        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            return result.success ? result.files : null;
        } catch (error) {
            console.error('上传错误:', error);
            return null;
        }
    }

    getFileIcon(mimetype) {
        if (!mimetype) return '📄';
        
        if (mimetype.startsWith('image/')) return '🖼️';
        if (mimetype.startsWith('video/')) return '🎥';
        if (mimetype.startsWith('audio/')) return '🎵';
        if (mimetype.includes('pdf')) return '📕';
        if (mimetype.includes('word') || mimetype.includes('document')) return '📘';
        if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return '📗';
        if (mimetype.includes('powerpoint') || mimetype.includes('presentation')) return '📙';
        if (mimetype.includes('zip') || mimetype.includes('rar') || mimetype.includes('7z')) return '📦';
        if (mimetype.includes('text')) return '📝';
        
        return '📄';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    exportChatHistory() {
        const messages = document.querySelectorAll('#messages .message');
        if (messages.length === 0) {
            this.showAlert('暂无聊天记录可导出');
            return;
        }

        let text = `===== ${this.currentChannel || '聊天'}记录 =====\n\n`;
        
        messages.forEach(msg => {
            const header = msg.querySelector('.message-header');
            const messageText = msg.querySelector('.message-text');
            const fileCount = msg.querySelectorAll('.file-message').length;
            
            if (header) {
                text += `${header.textContent}\n`;
            }
            
            if (messageText) {
                text += `内容: ${messageText.textContent}\n`;
            }
            
            if (fileCount > 0) {
                text += `附件: ${fileCount} 个文件\n`;
            }
            
            text += '\n';
        });
        
        text += '===== 记录结束 =====';
        
        // 创建下载
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentChannel || '聊天'}记录_${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async openFilesModal() {
        const modal = document.getElementById('filesModal');
        const filesList = document.getElementById('filesList');
        const filesStats = document.getElementById('filesStats');
        
        try {
            const response = await fetch('/api/files');
            const result = await response.json();
            
            if (result.success) {
                // 显示文件列表
                if (result.files.length === 0) {
                    filesList.innerHTML = '<p style="text-align: center; color: #666; padding: 2rem;">暂无已保存的文件</p>';
                } else {
                    filesList.innerHTML = result.files.map(file => this.createFileCard(file)).join('');
                }
                
                // 显示统计信息
                let totalSize = result.files.reduce((sum, file) => sum + file.size, 0);
                filesStats.innerHTML = `共 ${result.files.length} 个文件，总大小: ${this.formatFileSize(totalSize)}`;
                
                modal.classList.remove('hidden');
            }
        } catch (error) {
            console.error('获取文件列表失败:', error);
            this.showAlert('获取文件列表失败');
        }
    }

    closeFilesModal() {
        const modal = document.getElementById('filesModal');
        modal.classList.add('hidden');
    }

    createFileCard(file) {
        const icon = this.getFileIconByFilename(file.filename);
        const uploadTime = new Date(file.uploadTime).toLocaleString('zh-CN');
        
        return `
            <div class="file-card">
                <div class="file-card-header">${icon}</div>
                <div class="file-card-name" title="${file.filename}">${file.filename}</div>
                <div class="file-card-info">
                    <span>大小: ${this.formatFileSize(file.size)}</span>
                    <span>上传时间: ${uploadTime}</span>
                </div>
                <div class="file-card-actions">
                    <a href="/uploads/${file.filename}" download="${file.filename}" class="file-card-btn file-download">⬇ 下载</a>
                    <button class="file-card-btn file-delete" onclick="chatApp.deleteFile('${file.filename}')">🗑 删除</button>
                </div>
            </div>
        `;
    }

    getFileIconByFilename(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) return '🖼️';
        if (['mp4', 'avi', 'mkv', 'mov', 'wmv'].includes(ext)) return '🎥';
        if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return '🎵';
        if (ext === 'pdf') return '📕';
        if (['doc', 'docx'].includes(ext)) return '📘';
        if (['xls', 'xlsx'].includes(ext)) return '📗';
        if (['ppt', 'pptx'].includes(ext)) return '📙';
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
        if (['txt', 'md', 'log'].includes(ext)) return '📝';
        if (['html', 'css', 'js', 'json', 'xml', 'py', 'java', 'c', 'cpp'].includes(ext)) return '💻';
        
        return '📄';
    }

    async deleteFile(filename) {
        if (!confirm(`确定要删除文件 "${filename}" 吗？此操作不可恢复。`)) {
            return;
        }

        try {
            const response = await fetch(`/api/files/${filename}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showAlert('文件删除成功');
                this.openFilesModal(); // 刷新文件列表
            } else {
                this.showAlert(result.error || '删除失败');
            }
        } catch (error) {
            console.error('删除文件失败:', error);
            this.showAlert('删除文件失败');
        }
    }

    showAlert(message) {
        // 创建自定义弹窗
        const alertDiv = document.createElement('div');
        alertDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            text-align: center;
        `;
        
        const text = document.createElement('p');
        text.textContent = message;
        text.style.marginBottom = '1rem';
        
        const btn = document.createElement('button');
        btn.textContent = '确定';
        btn.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 0.5rem 1.5rem;
            border-radius: 5px;
            cursor: pointer;
        `;
        
        btn.addEventListener('click', () => {
            document.body.removeChild(alertDiv);
        });
        
        alertDiv.appendChild(text);
        alertDiv.appendChild(btn);
        document.body.appendChild(alertDiv);
    }

    // 频道相关方法
    updateChannelList(channels) {
        this.channelsData = channels;
        const channelListElement = document.getElementById('channelList');
        channelListElement.innerHTML = '';

        // 先构建频道->用户的映射
        const channelUsersMap = {};
        Object.keys(channels).forEach(channelName => {
            channelUsersMap[channelName] = [];
        });

        // 将用户分配到对应频道
        Object.keys(this.userChannels).forEach(username => {
            const userChannel = this.userChannels[username];
            if (channelUsersMap[userChannel]) {
                channelUsersMap[userChannel].push(username);
            }
        });

        // 显示所有频道
        Object.keys(channels).forEach(channelName => {
            const channelInfo = channels[channelName];
            const users = channelUsersMap[channelName] || [];
            const isSystem = channelInfo.isSystem || false;

            const li = document.createElement('li');
            li.className = `channel-item ${this.currentChannel === channelName ? 'active' : ''}`;

            // 构建用户列表HTML（只显示有人的频道）
            let usersHtml = '';
            if (users.length > 0) {
                usersHtml = '<div class="channel-users">';
                users.forEach(username => {
                    const displayName = username === this.username ? `${username} (我)` : username;
                    usersHtml += `<div class="channel-user-item">👤 ${displayName}</div>`;
                });
                usersHtml += '</div>';
            }

            // 只有非系统频道才显示删除按钮
            let deleteHtml = '';
            if (!isSystem) {
                deleteHtml = `<button class="channel-delete-btn" data-channel="${channelName}">🗑️</button>`;
            }

            li.innerHTML = `
                <div class="channel-info">
                    <span class="channel-name">📢 ${channelName}</span>
                    <span class="channel-count">${users.length}人在线</span>
                    ${deleteHtml}
                </div>
                ${usersHtml}
            `;

            // 点击频道名称加入频道
            li.addEventListener('click', (e) => {
                if (!e.target.classList.contains('channel-delete-btn')) {
                    this.joinChannel(channelName);
                }
            });

            // 删除按钮事件
            if (!isSystem) {
                const deleteBtn = li.querySelector('.channel-delete-btn');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteChannel(channelName);
                });
            }

            channelListElement.appendChild(li);
        });

        // 如果没有频道，显示提示
        if (channelListElement.children.length === 0) {
            channelListElement.innerHTML = '<li class="channel-empty">暂无频道</li>';
        }
    }

    joinChannel(channelName) {
        if (this.currentChannel === channelName) {
            return; // 已经在该频道
        }

        this.currentChannel = channelName;
        
        // 更新当前频道显示
        document.getElementById('currentChannelDisplay').textContent = `频道: ${channelName}`;
        
        // 发送加入频道请求
        this.socket.emit('joinChannel', channelName);
    }

    openCreateChannelModal() {
        const modal = document.getElementById('createChannelModal');
        modal.classList.remove('hidden');
        document.getElementById('newChannelName').focus();
    }

    closeCreateChannelModal() {
        const modal = document.getElementById('createChannelModal');
        modal.classList.add('hidden');
        document.getElementById('newChannelName').value = '';
    }

    createChannel() {
        const channelNameInput = document.getElementById('newChannelName');
        const channelName = channelNameInput.value.trim();

        if (!channelName) {
            this.showAlert('请输入频道名称');
            return;
        }

        this.socket.emit('createChannel', channelName);
        this.closeCreateChannelModal();
    }

    deleteChannel(channelName) {
        if (confirm(`确定要删除频道 "${channelName}" 吗？此操作不可恢复。`)) {
            this.socket.emit('deleteChannel', channelName);
        }
    }
}

// 页面加载完成后初始化聊天应用
let chatApp;
document.addEventListener('DOMContentLoaded', () => {
    chatApp = new ChatApp();
});