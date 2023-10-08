import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Alert, ActivityIndicator, Image, Button } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

import { db, storage, app } from './components/config';
import { doc, addDoc, getDocs, getDoc, collection, updateDoc, deleteDoc, onSnapshot, orderBy, query, where, setDoc, arrayUnion } from 'firebase/firestore';

import { getStorage, ref, uploadBytes, getDownloadURL, uploadBytesResumable } from 'firebase/storage';

export default function App() {
    const [location, setLocation] = useState(null);
    const mapRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [markers, setMarkers] = useState([]);
    const [address, setAddress] = useState(null);
    const [selectedImage, setSelectedImage] = useState(null);
    const [newMarkerRef, setNewMarkerRef] = useState(null);

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission to access location was denied');
                setLoading(false);
                return;
            }

            let locationSubscription;

            const updateAddress = async (latitude, longitude) => {
                const result = await Location.reverseGeocodeAsync({ latitude, longitude });
                const addr = result[0];
                const formattedAddress = `${addr.street}, ${addr.city}, ${addr.region}, ${addr.country}`;
                setAddress(formattedAddress);
                setLoading(false);
            };

            const initialLocation = await Location.getCurrentPositionAsync();
            setLocation(initialLocation);
            await updateAddress(initialLocation.coords.latitude, initialLocation.coords.longitude);

            locationSubscription = await Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.BestForNavigation,
                    distanceInterval: 1,
                },
                newLocation => {
                    setLocation(newLocation);
                    updateAddress(newLocation.coords.latitude, newLocation.coords.longitude);
                }
            );

            return () => {
                if (locationSubscription) {
                    locationSubscription.remove();
                }
            };
        })();
    }, []);

    const pickImage = async markerIndex => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const imageUri = result.assets[0].uri;

            try {
                const response = await fetch(imageUri);
                const blob = await response.blob();

                if (newMarkerRef) {
                    const imageRef = ref(storage, `images/${Date.now()}_${newMarkerRef.id}`);
                    await uploadBytesResumable(imageRef, blob);

                    const downloadUrl = await getDownloadURL(imageRef);

                    // Add the image URL to Firestore
                    await updateDoc(newMarkerRef, {
                        photos: arrayUnion(imageUri),
                        imageURLs: arrayUnion(downloadUrl),
                    });

                    // Update local state
                    const updatedMarkers = [...markers];
                    if (!updatedMarkers[markerIndex]) {
                        updatedMarkers[markerIndex] = {};
                    }

                    if (!updatedMarkers[markerIndex].photos) {
                        updatedMarkers[markerIndex].photos = [];
                    }

                    if (!updatedMarkers[markerIndex].imageURLs) {
                        updatedMarkers[markerIndex].imageURLs = [];
                    }

                    updatedMarkers[markerIndex].photos.push(imageUri);
                    updatedMarkers[markerIndex].imageURLs.push(downloadUrl);

                    setMarkers(updatedMarkers);
                }
            } catch (error) {
                console.error('Error uploading image:', error);
            }
        }
    };

    const addMarker = async coordinate => {
        const { latitude, longitude } = coordinate;
        const result = await Location.reverseGeocodeAsync({ latitude, longitude });
        const address = result[0];

        try {
            const markersRef = collection(db, 'markers');
            const newMarkerRef = doc(markersRef);
            setNewMarkerRef(newMarkerRef); // Set newMarkerRef here

            const markerData = {
                coordinate,
                address: `${address.street}, ${address.city}, ${address.region}, ${address.country}`,
                imageURLs: [], // Initialize an empty array to store image URLs
                photos: [], // Initialize an empty array to store image URIs
            };
            await setDoc(newMarkerRef, markerData);

            const marker = {
                coordinate,
                address: `${address.street}, ${address.city}, ${address.region}, ${address.country}`,
                image: null,
            };
            setMarkers(prevMarkers => [...prevMarkers, marker]);
        } catch (error) {
            console.error('Error adding marker:', error);
        }
    };

    const fetchMarkers = async () => {
        try {
            const markersCollection = collection(db, 'markers');
            const markerSnapshot = await getDocs(markersCollection);
            const fetchedMarkers = markerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMarkers(fetchedMarkers);
        } catch (error) {
            console.error('Error fetching markers:', error);
        }
    };

    useEffect(() => {
        fetchMarkers();
    }, []);

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                ref={mapRef}
                initialRegion={
                    location
                        ? {
                              latitude: location.coords.latitude,
                              longitude: location.coords.longitude,
                              latitudeDelta: 0.0922,
                              longitudeDelta: 0.0421,
                          }
                        : undefined
                }
                onLongPress={e => {
                    const coords = e.nativeEvent.coordinate;
                    addMarker(coords);
                }}
            >
                {location && (
                    <Marker coordinate={location.coords} pinColor="red" zIndex={5}>
                        <Callout tooltip={true}>
                            <View style={styles.callout}>
                                <Text style={styles.title}>Address:</Text>
                                <Text style={styles.addressText}>{address}</Text>
                                <View style={styles.coordinateContainer}>
                                    <Text style={styles.title}>Latitude:</Text>
                                    <Text style={styles.coordinateText}>{location.coords.latitude.toFixed(2)}</Text>
                                </View>
                                <View style={styles.coordinateContainer}>
                                    <Text style={styles.title}>Longitude:</Text>
                                    <Text style={styles.coordinateText}>{location.coords.longitude.toFixed(2)}</Text>
                                </View>
                            </View>
                        </Callout>
                    </Marker>
                )}

                {markers.map((marker, index) => (
                    <Marker key={marker.id || index} coordinate={marker.coordinate} pinColor="blue" zIndex={5}>
                        <Callout tooltip={true}>
                            <View style={styles.callout}>
                                <Text style={styles.title}>Address:</Text>
                                <Text style={styles.addressText}>{marker.address}</Text>
                                <View style={styles.coordinateContainer}>
                                    <Text style={styles.title}>Latitude:</Text>
                                    <Text style={styles.coordinateText}>{marker.coordinate.latitude.toFixed(2)}</Text>
                                </View>
                                <View style={styles.coordinateContainer}>
                                    <Text style={styles.title}>Longitude:</Text>
                                    <Text style={styles.coordinateText}>{marker.coordinate.longitude.toFixed(2)}</Text>
                                </View>
                                <Button title="Add Photo" onPress={() => pickImage(index)} />
                                <View style={styles.imageGallery}>
                                    {marker.photos &&
                                        marker.photos.map((photo, photoIndex) => <Image key={photoIndex} source={{ uri: photo }} style={styles.image} />)}
                                </View>
                            </View>
                        </Callout>
                    </Marker>
                ))}
            </MapView>
            {loading && (
                <View style={styles.overlay}>
                    <ActivityIndicator size="large" color="#0000ff" />
                    <Text style={styles.overlayText}>Fetching location - Please wait</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    map: {
        width: '100%',
        height: '100%',
    },
    overlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(255,255,255,0.8)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    overlayText: {
        marginTop: 16,
    },
    callout: {
        padding: 10,
        backgroundColor: 'white',
        borderRadius: 10,
        width: 250,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
        borderColor: '#ddd',
        borderWidth: 1,
    },
    imageGallery: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 10,
        justifyContent: 'center',
    },
    image: {
        width: 70,
        height: 70,
        borderRadius: 5,
        margin: 5,
    },
    title: {
        fontWeight: 'bold',
    },
    addressText: {
        color: '#555',
        marginBottom: 10,
    },
    coordinateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    coordinateText: {
        color: '#555',
        marginLeft: 5,
    },
});
