'use strict';

var _ = require('lodash'),
    moment = require('moment'),
    Stanza = require('node-xmpp-core').Stanza,
    MessageProcessor = require('./../msg-processor'),
    settings = require('./../../config'),
    helper = require('./../helper');

module.exports = MessageProcessor.extend({

    if: function() {
        return !this.request.to &&
               !this.request.type &&
               this.request.name === 'presence';
    },

    then: function(cb) {
        var toParts = this.request.attrs.to.split('/'),
            roomUrl = toParts[0],
            nickname = toParts[1],
            roomSlug = roomUrl.split('@')[0];

        this.connection.nickname(roomSlug, nickname);

        var options = {
            userId: this.connection.user.id,
            slug: roomSlug,
            password: this.getPassword(),
            saveMembership: true
        };

        this.core.rooms.canJoin(options, function(err, room, canJoin) {
            if (err) {
                return cb(err);
            }

            if (room && canJoin) {
                return this.handleJoin(room, cb);
            }

            if (room && !canJoin) {
                return this.sendErrorPassword(room, cb);
            }

            if (!settings.xmpp.roomCreation) {
                return this.cantCreateRoom(roomSlug, cb);
            }

            return this.createRoom(roomSlug, function(err, room) {
                if (err) {
                    return cb(err);
                }
                this.handleJoin(room, cb);
            }.bind(this));

        }.bind(this));
    },

    createRoom: function(roomSlug, cb) {
        var password = this.getPassword();
        var options = {
            owner: this.connection.user.id,
            name: roomSlug,
            slug: roomSlug,
            description: '',
            password: password
        };
        if(!settings.rooms.private) {
            delete options.private;
            delete options.password;
        }
        this.core.rooms.create(options, cb);
    },

    cantCreateRoom: function(roomSlug, cb) {
        var presence = this.Presence({
            from: this.connection.getRoomJid(roomSlug, 'admin'),
            type: 'error'
        });

        var msgs = [];

        var users = this.core.presence.system.connections.getUsers({
            type: 'xmpp' // Only XMPP supports private messaging - for now
        });

        cb(null, presence);
    },

    _getXNode: function() {
        if(!this.xNode) {
            this.xNode = _.find(this.request.children, function(child) {
                return child.name === 'x';
            });
        }
        return this.xNode;
    },

    getHistoryNode: function() {
        var xNode = this._getXNode();
        if (xNode) {
            return _.find(xNode.children, function(child) {
                return child.name === 'history';
            });
        }
    },

    getPassword: function() {
        var xNode = this._getXNode();
        if (xNode) {
            var passwordNode = _.find(xNode.children, function(child) {
                return child.name === 'password';
            });
            if(passwordNode && passwordNode.children) {
                return passwordNode.children[0];
            }
        }

        return '';
    },

    sendErrorPassword: function(room, cb) {
        //from http://xmpp.org/extensions/xep-0045.html#enter-pw
        var presence = this.Presence({
            type: 'error'
        });

        presence
            .c('x', {
                xmlns: 'http://jabber.org/protocol/muc'
            });
        presence
            .c('error', {
                type: 'auth',
                by: this.connection.getRoomJid(room.slug)
            })
            .c('not-authorized', {
                xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas'
            });

        return cb(null, presence);
    },

    handleJoin: function(room, cb) {
        var username = this.connection.user.username;

        var proom = this.core.presence.rooms.get(room._id);
        var usernames = proom ? proom.getUsernames() : [];

        // User's own presence must be last - and be their nickname
        var i = usernames.indexOf(username);
        if (i > -1) {
            usernames.splice(i, 1);
        }
        usernames.push(this.connection.user.username);


            var presence = this.Presence({
                from: helper.getUserJid(user.username),
                type: undefined
            });

            helper.populateVcard(presence, user);

            // TODO: Add avatar for each room user
            // helper.populateVcard(presence, user, this.core);

            return presence;

        }, this);

        var subject = this.Message({
            type: 'groupchat'
        });

        subject.c('subject').t(room.name + ' | ' + room.description);

        var historyNode = this.getHistoryNode();

        if (!historyNode ||
            historyNode.attrs.maxchars === 0 ||
            historyNode.attrs.maxchars === '0') {
                // Send no history
                this.core.presence.join(this.connection, room);
                return cb(null, presences, subject);
        }

        var query = {
            userId: this.connection.user.id,
            room: room._id,
            expand: 'owner'
        };

        if (historyNode.attrs.since) {
            query.from = moment(historyNode.attrs.since).utc().toDate();
        }

        if (historyNode.attrs.seconds) {
            query.from = moment()
                .subtract(historyNode.attrs.seconds, 'seconds')
                .utc()
                .toDate();
        }

        if (historyNode.attrs.maxstanzas) {
            query.take = historyNode.attrs.maxstanzas;
        }

        this.core.messages.list(query, function(err, messages) {
            if (err) {
                return cb(err);
            }

            messages.reverse();

            var msgs = messages.map(function(msg) {

                var stanza = new Stanza.Message({
                    id: msg._id,
                    type: 'groupchat',
                    to: this.connection.getRoomJid(room.slug),
                    from: this.connection.getRoomJid(room.slug, msg.owner.username)
                });

                stanza.c('body').t(msg.text);

                stanza.c('delay', {
                    xmlns: 'urn:xmpp:delay',
                    from: this.connection.getRoomJid(room.slug),
                    stamp: msg.posted.toISOString()
                });

                stanza.c('addresses', {
                    xmlns: 'http://jabber.org/protocol/address'
                }).c('address', {
                    type: 'ofrom',
                    jid: this.connection.getUserJid(msg.owner.username)
                });

                return stanza;

            }, this);

            this.core.presence.join(this.connection, room);
            cb(null, presences, msgs, subject);

        }.bind(this));
    }

});
