##################################
# set up the server              #
# (command to run on the server) #
##################################

git clone --depth=1 https://github.com/jasonszhao/rss-reader.git
cd rss-reader

# set up the service 
sudo echo "
[Unit]
Description=runs the Node server for the RSS Reader app

[Service]
Type=simple
Restart=always
ExecStart=/usr/bin/npm start
User=Jason
WorkingDirectory=/home/Jason/rss-reader

[Install]
WantedBy=multi-user.target
" >! /etc/systemd/system/rss-service.service

sudo systemctl daemon-reload
sudo systemctl enable rss-reader.service
sudo systemctl start rss-reader


# port forwarding
sudo echo "pre-up iptables-restore < /etc/iptables.rules" >> /etc/network/interfaces
sudo echo "post-down iptables-save > /etc/iptables.rules" >> /etc/network/interfaces

sudo iptables -t nat -I PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 3000
sudo iptables -t nat -I OUTPUT -p tcp -o lo --dport 80 -j REDIRECT --to-ports 3000


