# AirBridge
AirMessage Bridge for SMServer!
  

Hey everyone! I've been working on a script that allows you to use an iPhone as an AirMessage server! It's in alpha and might have weird glitches, so I'd recommend having a Mac to serve as a backup (i.e. enable NAT loopback/hairpinning and set the fallback address as the address on your Mac). It's open source, and you can find it on GitHub [here](https://github.com/SixDigitCode/AirBridge).

**What works**

-   Sending messages
    
-   Sending attachments
    
-   Sending tapbacks! At the moment the process is a little clunky, but should work for most text messages. See the "How to send a tapback" section below.
    
-   Receiving messages (includes tapbacks, read receipts)
    
-   Receiving attachments
    
-   WebSockets and message pushing! There's no need to set a refresh interval as SMServer pushes messages to AirBridge, which means messages should arrive nearly instantly. (Messages typically arrive 0.8 seconds after being received on the iPhone)
    
-   Stickers kind of work, but they show up as attachments for now
    
-   Creating a chat should work, but I haven't done extensive testing. Group creation doesn't work at the moment.
    

  

**What doesn't work (at the moment)**

-   I've gotten AirBridge to run on the iPhone itself but it still needs some optimizations. If anyone knows how to package a NodeJS script into a Cydia tweak please let me know!
    
-   The Electron client (for Windows/Mac) currently can't fetch messages or conversations (I have a planned fix for this)
    
-   Group chats have some issues:
    
    -   SMServer doesn't currently support viewing the list of members in a group (though it will be in the next update--see [this](https://github.com/iandwelker/smserver/issues/130) for more info).
        
    -   It isn't possible at the moment to create a group (see [this](https://github.com/iandwelker/smserver/issues/133) for more info)
        
    -   It isn't possible at the moment to add people to a group
        
-   SMServer tends to crash when downloading large attachments
    
-   SMServer doesn't support "Sending", "Sent", or "Delivered" statuses (all messages report as "sent"). Read receipts and the "Read" status should work.
    
-   Sending or receiving message effects (SMServer doesn't support these yet, but it might be possible by directly accessing SMS.db)
    
-   AirMessage Cloud (the developer has kindly asked third-party developers to not use the official AM cloud servers)
    

  

**What SMServer supports but AirMessage doesn't support (yet)**

-   Sending read receipts
    
-   "Officially" sending tapbacks via the AirMessage app isn't supported right now, so tapbacks are a little clunky at the moment and attachment reactions aren't possible.
    
-   Sending typing indicators
    
-   Receiving typing indicators
    
-   iMessage apps/GamePigeon. SMServer doesn't officially support this, but it might be possible to set up the iPhone as a VNC server and remote-control it from a webpage running on the Android phone. I'm not sure how that would work with a self-signed certificate though, as running it over HTTP isn't a great idea.
    

  

**Installation instructions** (Please let me know if you have any questions or if any of this doesn't make sense--I'm working on bundling this into a Cydia tweak for easy installation)

**You will need:**

-   A spare computer that will always be on and connected to your network. This doesn't need to be a Mac--just something that can run Node. Macs, PCs, Linux boxes, and Raspberry Pis should all work. I'm working on getting AirBridge running on an iPhone and making the installation much easier, so this requirement will (hopefully) not stick around for much longer.
    
-   A jailbroken iPhone with iOS 13 or 14 (though SMServer will likely have support for iOS 12 in the near future). I used [Checkra1n](https://checkra.in/) on my iPhone SE, but YMMV.
    
-   An Android phone (obviously). Support for AirMessage Electron clients is coming soon.
    

**How to install (part 1):**

1.  Jailbreak your iPhone if you haven't already
    
2.  Open Cydia and go to the Sources tab. Choose "Edit" and add [https://repo.twickd.com/](https://repo.twickd.com/).
    
3.  Search for and install the SMServer tweak.
    
4.  Open SMServer and choose a password. Make sure the port is set to 8741.
    
5.  In the SMServer settings, make sure "Automatically mark as read" is turned off.
    
6.  Make sure to [create a DHCP reservation](https://lifehacker.com/how-to-set-up-dhcp-reservations-and-never-check-an-ip-5822605) in your router settings for your iPhone and computer. You can google "Create DHCP reservation [router brand]" for specific instructions on how to do this.
    

**How to install (part 2):**

1.  On your computer, download and install [Git](https://git-scm.com/downloads) and [NodeJS](https://nodejs.org/en/download/).
    
2.  Open a command prompt (Windows) or terminal (Mac/Linux).
    
    1.  Enter git clone [https://github.com/SixDigitCode/AirBridge.git](https://github.com/SixDigitCode/AirBridge.git) and press enter. Then cd AirBridge and run npm install.
        
    2.  Open settings.txt in a text editor and enter your settings, replacing the example values. Change SMSERVER_IP to the IP address of your iPhone (you can find it in Settings > Wi-Fi > [Your network] > IP Address), set SMSERVER_PASSWORD to the password you chose earlier, and choose a password for AIRMESSAGE_PASSWORD. Save the file.
        
    3.  Once NPM is done installing, run node index.js in your command prompt/terminal. If you see a green message that says "SMServer WebSocket Client Connected", your computer has successfully connected to SMServer on the iPhone!
        
3.  On your Android phone, open AirMessage and choose "Use manual configuration". Your server address should be the IP address of the computer running AirBridge (not the IP of the iPhone), and the password should be whatever you set for AIRMESSAGE_PASSWORD earlier. If all goes well, you should see a bunch of activity on your computer (where AirBridge is running) and your Android phone should connect!
    
4.  If your Android phone doesn't connect and you're sure your password is right, please PM me with the AirBridge logs and I'd be happy to help you out.
    

  

**How to send a tapback**

Tapback sending isn't officially supported by AirMessage. That said, I've implemented a (slightly clunky) way of sending a tapback to a text message (attachments aren't supported at the moment).

To use it, reply with a message that looks like this: /tapback [tapback type] Copy and paste message here

The tapback type is pretty flexible. Any of the following should work: Here are some [examples](https://imgur.com/a/4uwy8j4) as well.

-   Heart: 💖, 💕, heart, love, loved
    
-   Thumbs up: 👍, thumbs_up, like, liked
    
-   Thumbs down: 👎, thumbs_down, dislike, disliked
    
-   Laugh: 🤣, 😂, 😆, laughed, laughed_at, haha, lol
    
-   Emphasis: ‼️, ❗, ❕, !, emphasis, emphasized, exclamation
    
-   Question: ❓, ❔, ?, question_mark, question, what
